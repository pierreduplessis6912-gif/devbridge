import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(field + ' must be a non-empty string');
  }
  return value.trim();
}

function withTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

/**
 * Session lifecycle persistence and initial activation coordinator.
 * It uses the same SQLite file as the continuity store but keeps the
 * lifecycle API in its own module. Provider delivery occurs outside DB
 * transactions; activation is committed only after a matching acknowledgement.
 */
export function openSessionLifecycle(databasePath, continuityStore, { confirmationAuthority } = {}) {
  if (!continuityStore || typeof continuityStore.buildHandover !== 'function'
    || typeof continuityStore.getProject !== 'function') {
    throw new TypeError('continuityStore with project and handover methods is required');
  }

  if (!confirmationAuthority || typeof confirmationAuthority.consume !== 'function') {
    throw new TypeError('A trusted confirmationAuthority with consume() is required');
  }

  const db = new DatabaseSync(requiredText(databasePath, 'databasePath'));
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  withTransaction(db, () => db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider_name TEXT,
      model_name TEXT,
      external_conversation_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS activation_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      requested_at TEXT NOT NULL,
      -- Legacy claim fields retained for additive schema compatibility; never trusted.
      confirmed_project_id TEXT,
      confirmed_by TEXT,
      confirmation_method TEXT,
      confirmed_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS activation_confirmations (
      id TEXT PRIMARY KEY,
      activation_request_id TEXT NOT NULL UNIQUE REFERENCES activation_requests(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      actor_id TEXT NOT NULL,
      confirmation_method TEXT NOT NULL,
      authority_reference TEXT NOT NULL,
      confirmed_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS handover_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      activation_request_id TEXT NOT NULL REFERENCES activation_requests(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      format TEXT NOT NULL,
      history_boundary TEXT,
      payload_json TEXT NOT NULL,
      generated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS context_delivery_intents (
      id TEXT PRIMARY KEY,
      activation_request_id TEXT NOT NULL UNIQUE REFERENCES activation_requests(id),
      handover_snapshot_id TEXT NOT NULL UNIQUE REFERENCES handover_snapshots(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS context_delivery_attempts (
      id TEXT PRIMARY KEY,
      activation_request_id TEXT NOT NULL REFERENCES activation_requests(id),
      handover_snapshot_id TEXT NOT NULL REFERENCES handover_snapshots(id),
      outcome TEXT NOT NULL CHECK (outcome IN ('acknowledged', 'failed', 'unknown')),
      acknowledgement_level TEXT,
      provider_reference TEXT,
      attempted_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS project_activations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      activation_request_id TEXT NOT NULL UNIQUE REFERENCES activation_requests(id),
      handover_snapshot_id TEXT NOT NULL REFERENCES handover_snapshots(id),
      delivery_attempt_id TEXT NOT NULL UNIQUE REFERENCES context_delivery_attempts(id),
      activated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outgoing_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      outgoing_activation_id TEXT NOT NULL UNIQUE REFERENCES project_activations(id),
      incoming_activation_request_id TEXT NOT NULL UNIQUE REFERENCES activation_requests(id),
      handover_snapshot_id TEXT NOT NULL REFERENCES handover_snapshots(id),
      project_event_sequence INTEGER NOT NULL CHECK (project_event_sequence > 0),
      project_event_id TEXT NOT NULL REFERENCES project_events(id),
      project_event_at TEXT NOT NULL,
      project_record_count INTEGER NOT NULL CHECK (project_record_count >= 0),
      project_event_count INTEGER NOT NULL CHECK (project_event_count > 0),
      lifecycle_event_sequence INTEGER NOT NULL CHECK (lifecycle_event_sequence > 0),
      checkpointed_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS session_lifecycle_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      event_type TEXT NOT NULL,
      project_id TEXT REFERENCES projects(id),
      activation_request_id TEXT REFERENCES activation_requests(id),
      activation_id TEXT REFERENCES project_activations(id),
      handover_snapshot_id TEXT REFERENCES handover_snapshots(id),
      delivery_attempt_id TEXT REFERENCES context_delivery_attempts(id),
      checkpoint_id TEXT REFERENCES outgoing_checkpoints(id),
      summary TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE(session_id, sequence)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS activation_requests_session
      ON activation_requests(session_id, requested_at, id);
    CREATE INDEX IF NOT EXISTS project_activations_session
      ON project_activations(session_id, activated_at, id);
    CREATE INDEX IF NOT EXISTS session_events_order
      ON session_lifecycle_events(session_id, sequence);
    CREATE INDEX IF NOT EXISTS outgoing_checkpoints_session
      ON outgoing_checkpoints(session_id, checkpointed_at, id);

    CREATE TRIGGER IF NOT EXISTS outgoing_checkpoints_scope_insert
      BEFORE INSERT ON outgoing_checkpoints
      WHEN NOT EXISTS (
        SELECT 1 FROM project_activations a
        JOIN activation_requests r ON r.id = NEW.incoming_activation_request_id
        JOIN activation_confirmations c ON c.activation_request_id = r.id
        JOIN project_events p ON p.id = NEW.project_event_id
        WHERE a.id = NEW.outgoing_activation_id
          AND a.session_id = NEW.session_id
          AND a.project_id = NEW.project_id
          AND a.handover_snapshot_id = NEW.handover_snapshot_id
          AND r.session_id = NEW.session_id
          AND r.project_id <> NEW.project_id
          AND p.project_id = NEW.project_id
          AND p.event_sequence = NEW.project_event_sequence
          AND p.occurred_at = NEW.project_event_at
          AND NEW.project_event_count = (
            SELECT COUNT(*) FROM project_events e
            WHERE e.project_id = NEW.project_id
              AND e.event_sequence <= NEW.project_event_sequence
          )
          AND NEW.project_record_count = (
            SELECT COUNT(*) FROM project_records pr
            WHERE pr.project_id = NEW.project_id
              AND EXISTS (
                SELECT 1 FROM project_events e
                WHERE e.project_id = pr.project_id
                  AND e.record_id = pr.id
                  AND e.event_sequence <= NEW.project_event_sequence
              )
          )
          AND NEW.lifecycle_event_sequence = (
            SELECT COALESCE(MAX(sequence), 0)
            FROM session_lifecycle_events WHERE session_id = NEW.session_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM session_lifecycle_events e
            WHERE e.activation_id = a.id AND e.event_type = 'activation_ended'
          )
      )
      BEGIN SELECT RAISE(ABORT, 'checkpoint must match an active outgoing activation and a different confirmed target request'); END;

    CREATE TRIGGER IF NOT EXISTS outgoing_checkpoints_no_update BEFORE UPDATE ON outgoing_checkpoints
      BEGIN SELECT RAISE(ABORT, 'outgoing checkpoints are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS outgoing_checkpoints_no_delete BEFORE DELETE ON outgoing_checkpoints
      BEGIN SELECT RAISE(ABORT, 'outgoing checkpoints are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS activation_confirmations_scope_insert
      BEFORE INSERT ON activation_confirmations
      WHEN NOT EXISTS (
        SELECT 1 FROM activation_requests r
        WHERE r.id = NEW.activation_request_id
          AND r.session_id = NEW.session_id
          AND r.project_id = NEW.project_id
      )
      BEGIN SELECT RAISE(ABORT, 'confirmation scope must match activation request'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_intents_scope_insert
      BEFORE INSERT ON context_delivery_intents
      WHEN NOT EXISTS (
        SELECT 1 FROM activation_requests r
        JOIN handover_snapshots h ON h.activation_request_id = r.id
        WHERE r.id = NEW.activation_request_id
          AND h.id = NEW.handover_snapshot_id
          AND h.session_id = r.session_id
          AND h.project_id = r.project_id
      )
      BEGIN SELECT RAISE(ABORT, 'delivery intent must match activation request and handover'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_attempts_intent_insert
      BEFORE INSERT ON context_delivery_attempts
      WHEN NOT EXISTS (
        SELECT 1 FROM context_delivery_intents i
        WHERE i.activation_request_id = NEW.activation_request_id
          AND i.handover_snapshot_id = NEW.handover_snapshot_id
      )
      BEGIN SELECT RAISE(ABORT, 'delivery attempt must match persisted delivery intent'); END;
    CREATE TRIGGER IF NOT EXISTS activations_evidence_insert
      BEFORE INSERT ON project_activations
      WHEN NOT EXISTS (
        SELECT 1 FROM activation_requests r
        JOIN activation_confirmations c ON c.activation_request_id = r.id
        JOIN handover_snapshots h ON h.activation_request_id = r.id
        JOIN context_delivery_intents i ON i.activation_request_id = r.id
        JOIN context_delivery_attempts d ON d.activation_request_id = r.id
        WHERE r.id = NEW.activation_request_id
          AND r.session_id = NEW.session_id
          AND r.project_id = NEW.project_id
          AND c.session_id = NEW.session_id
          AND c.project_id = NEW.project_id
          AND h.id = NEW.handover_snapshot_id
          AND i.handover_snapshot_id = NEW.handover_snapshot_id
          AND d.id = NEW.delivery_attempt_id
          AND d.handover_snapshot_id = NEW.handover_snapshot_id
          AND d.outcome = 'acknowledged'
          AND d.acknowledgement_level IS NOT NULL
      )
      BEGIN SELECT RAISE(ABORT, 'activation requires matching confirmed acknowledged delivery'); END;

    CREATE TRIGGER IF NOT EXISTS sessions_no_update BEFORE UPDATE ON sessions
      BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS sessions_no_delete BEFORE DELETE ON sessions
      BEGIN SELECT RAISE(ABORT, 'sessions are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activation_requests_no_update BEFORE UPDATE ON activation_requests
      BEGIN SELECT RAISE(ABORT, 'activation requests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activation_requests_no_delete BEFORE DELETE ON activation_requests
      BEGIN SELECT RAISE(ABORT, 'activation requests are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activation_confirmations_no_update BEFORE UPDATE ON activation_confirmations
      BEGIN SELECT RAISE(ABORT, 'activation confirmations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activation_confirmations_no_delete BEFORE DELETE ON activation_confirmations
      BEGIN SELECT RAISE(ABORT, 'activation confirmations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS handover_snapshots_no_update BEFORE UPDATE ON handover_snapshots
      BEGIN SELECT RAISE(ABORT, 'handover snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS handover_snapshots_no_delete BEFORE DELETE ON handover_snapshots
      BEGIN SELECT RAISE(ABORT, 'handover snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_intents_no_update BEFORE UPDATE ON context_delivery_intents
      BEGIN SELECT RAISE(ABORT, 'delivery intents are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_intents_no_delete BEFORE DELETE ON context_delivery_intents
      BEGIN SELECT RAISE(ABORT, 'delivery intents are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_attempts_no_update BEFORE UPDATE ON context_delivery_attempts
      BEGIN SELECT RAISE(ABORT, 'delivery attempts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS delivery_attempts_no_delete BEFORE DELETE ON context_delivery_attempts
      BEGIN SELECT RAISE(ABORT, 'delivery attempts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activations_no_update BEFORE UPDATE ON project_activations
      BEGIN SELECT RAISE(ABORT, 'project activations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS activations_no_delete BEFORE DELETE ON project_activations
      BEGIN SELECT RAISE(ABORT, 'project activations are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_update BEFORE UPDATE ON session_lifecycle_events
      BEGIN SELECT RAISE(ABORT, 'session lifecycle events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS lifecycle_events_no_delete BEFORE DELETE ON session_lifecycle_events
      BEGIN SELECT RAISE(ABORT, 'session lifecycle events are append-only'); END;
  `));

  // Existing databases may have the lifecycle event table from the earlier
  // additive schema. Add the checkpoint reference without rebuilding history.
  const lifecycleEventColumns = db.prepare('PRAGMA table_info(session_lifecycle_events)').all();
  if (!lifecycleEventColumns.some((column) => column.name === 'checkpoint_id')) {
    db.exec('ALTER TABLE session_lifecycle_events ADD COLUMN checkpoint_id TEXT REFERENCES outgoing_checkpoints(id)');
  }

  let closed = false;
  const ensureOpen = () => { if (closed) throw new Error('Session lifecycle store is closed'); };

  function appendEvent(event) {
    const sequence = db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM session_lifecycle_events WHERE session_id = ?',
    ).get(event.sessionId).sequence;
    db.prepare(`
      INSERT INTO session_lifecycle_events
        (id, session_id, sequence, event_type, project_id, activation_request_id,
         activation_id, handover_snapshot_id, delivery_attempt_id, checkpoint_id, summary, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), event.sessionId, sequence, event.eventType,
      event.projectId ?? null, event.activationRequestId ?? null,
      event.activationId ?? null, event.handoverSnapshotId ?? null,
      event.deliveryAttemptId ?? null, event.checkpointId ?? null,
      event.summary, event.occurredAt,
    );
  }

  return {
    createSession({ id = randomUUID(), providerName = null, modelName = null,
      externalConversationId = null, createdAt = new Date().toISOString() } = {}) {
      ensureOpen();
      const sessionId = requiredText(id, 'id');
      const timestamp = requiredText(createdAt, 'createdAt');
      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO sessions (id, provider_name, model_name, external_conversation_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(sessionId, providerName, modelName, externalConversationId, timestamp);
        appendEvent({
          sessionId, eventType: 'session_created',
          summary: 'DevBridge Session created', occurredAt: timestamp,
        });
      });
      return this.getSession(sessionId);
    },

    getSession(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, provider_name AS providerName, model_name AS modelName,
          external_conversation_id AS externalConversationId, created_at AS createdAt
        FROM sessions WHERE id = ?
      `).get(requiredText(sessionId, 'sessionId')) ?? null;
    },

    listEvents(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, session_id AS sessionId, sequence, event_type AS eventType,
          project_id AS projectId, activation_request_id AS activationRequestId,
          activation_id AS activationId, handover_snapshot_id AS handoverSnapshotId,
          delivery_attempt_id AS deliveryAttemptId, checkpoint_id AS checkpointId,
          summary, occurred_at AS occurredAt
        FROM session_lifecycle_events WHERE session_id = ? ORDER BY sequence
      `).all(requiredText(sessionId, 'sessionId'));
    },

    listActivations(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, session_id AS sessionId, project_id AS projectId,
          activation_request_id AS activationRequestId,
          handover_snapshot_id AS handoverSnapshotId,
          delivery_attempt_id AS deliveryAttemptId, activated_at AS activatedAt
        FROM project_activations WHERE session_id = ? ORDER BY rowid
      `).all(requiredText(sessionId, 'sessionId'));
    },

    getActiveActivation(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT a.id, a.session_id AS sessionId, a.project_id AS projectId,
          a.activation_request_id AS activationRequestId,
          a.handover_snapshot_id AS handoverSnapshotId,
          a.delivery_attempt_id AS deliveryAttemptId, a.activated_at AS activatedAt
        FROM project_activations a
        WHERE a.session_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM session_lifecycle_events e
            WHERE e.activation_id = a.id AND e.event_type = 'activation_ended'
          )
        ORDER BY a.rowid DESC LIMIT 1
      `).get(requiredText(sessionId, 'sessionId')) ?? null;
    },

    listDeliveryAttempts(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT d.id, i.id AS deliveryId,
          r.id AS activationRequestId,
          COALESCE(i.handover_snapshot_id, d.handover_snapshot_id) AS handoverSnapshotId,
          COALESCE(d.outcome, 'unknown') AS outcome,
          d.acknowledgement_level AS acknowledgementLevel,
          d.provider_reference AS providerReference,
          d.attempted_at AS attemptedAt, i.created_at AS intentCreatedAt,
          CASE WHEN d.id IS NULL OR d.outcome = 'unknown' THEN 1 ELSE 0 END AS unresolved
        FROM activation_requests r
        LEFT JOIN context_delivery_intents i ON i.activation_request_id = r.id
        LEFT JOIN context_delivery_attempts d ON d.activation_request_id = r.id
        WHERE r.session_id = ? AND (i.id IS NOT NULL OR d.id IS NOT NULL)
        ORDER BY r.requested_at, r.id
      `).all(requiredText(sessionId, 'sessionId'));
    },

    requestProjectActivation({
      sessionId, projectId, requestId = randomUUID(),
      requestedAt = new Date().toISOString(),
    }) {
      ensureOpen();
      const session = requiredText(sessionId, 'sessionId');
      const project = requiredText(projectId, 'projectId');
      const request = requiredText(requestId, 'requestId');
      const timestamp = requiredText(requestedAt, 'requestedAt');
      if (!this.getSession(session)) throw new Error('Session not found: ' + session);
      if (!continuityStore.getProject(project)) throw new Error('Project not found: ' + project);

      withTransaction(db, () => {
        const active = db.prepare(`
          SELECT a.id AS activationId, a.project_id AS projectId FROM project_activations a
          WHERE a.session_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM session_lifecycle_events e
              WHERE e.activation_id = a.id AND e.event_type = 'activation_ended'
            )
          LIMIT 1
        `).get(session);
        if (active?.projectId === project) {
          throw new Error('Project is already the active Project Activation');
        }
        const pending = db.prepare(`
          SELECT 1 FROM activation_requests r
          WHERE r.session_id = ?
            AND (
              NOT EXISTS (
                SELECT 1 FROM context_delivery_attempts d
                WHERE d.activation_request_id = r.id
              )
              OR EXISTS (
                SELECT 1 FROM context_delivery_attempts d
                WHERE d.activation_request_id = r.id AND d.outcome = 'unknown'
              )
            )
          LIMIT 1
        `).get(session);
        if (pending) throw new Error('Session already has an unresolved activation request');

        db.prepare(`
          INSERT INTO activation_requests
            (id, session_id, project_id, requested_at)
          VALUES (?, ?, ?, ?)
        `).run(request, session, project, timestamp);
        appendEvent({
          sessionId: session, eventType: 'activation_requested', projectId: project,
          activationRequestId: request, activationId: active?.activationId ?? null,
          summary: 'Activation requested for project ' + project,
          occurredAt: timestamp,
        });
      });
      return { id: request, sessionId: session, projectId: project, requestedAt: timestamp };
    },

    listCheckpoints(sessionId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, session_id AS sessionId, project_id AS projectId,
          outgoing_activation_id AS outgoingActivationId,
          incoming_activation_request_id AS incomingActivationRequestId,
          handover_snapshot_id AS handoverSnapshotId,
          project_event_sequence AS projectEventSequence,
          project_event_id AS projectEventId,
          project_event_at AS projectEventAt,
          project_record_count AS projectRecordCount,
          project_event_count AS projectEventCount,
          lifecycle_event_sequence AS lifecycleEventSequence,
          checkpointed_at AS checkpointedAt
        FROM outgoing_checkpoints
        WHERE session_id = ? ORDER BY rowid
      `).all(requiredText(sessionId, 'sessionId'));
    },

    checkpointActiveActivation({ requestId, checkpointedAt = null }) {
      ensureOpen();
      const request = requiredText(requestId, 'requestId');
      const incoming = db.prepare(`
        SELECT r.id, r.session_id AS sessionId, r.project_id AS projectId
        FROM activation_requests r
        JOIN activation_confirmations c ON c.activation_request_id = r.id
        WHERE r.id = ?
      `).get(request);
      if (!incoming) throw new Error('Checkpoint requires a confirmed incoming activation request');

      const outgoing = this.getActiveActivation(incoming.sessionId);
      if (!outgoing) throw new Error('Session has no active outgoing Project Activation to checkpoint');
      if (outgoing.projectId === incoming.projectId) {
        throw new Error('Cannot checkpoint an activation when the requested Project is already active');
      }

      const boundary = continuityStore.getProjectHistoryBoundary(outgoing.projectId);
      if (!boundary || boundary.projectId !== outgoing.projectId
        || !Number.isSafeInteger(boundary.eventSequence) || boundary.eventSequence < 1
        || typeof boundary.lastEventId !== 'string' || !boundary.lastEventId
        || !Number.isSafeInteger(boundary.recordCount)
        || !Number.isSafeInteger(boundary.eventCount) || boundary.eventCount < 1) {
        throw new Error('Continuity store returned an invalid Project history boundary');
      }
      const timestamp = requiredText(checkpointedAt ?? boundary.capturedAt, 'checkpointedAt');
      const checkpointId = randomUUID();

      withTransaction(db, () => {
        const stillConfirmed = db.prepare(`
          SELECT 1 FROM activation_requests r
          JOIN activation_confirmations c ON c.activation_request_id = r.id
          WHERE r.id = ? AND r.session_id = ? AND r.project_id = ?
        `).get(request, incoming.sessionId, incoming.projectId);
        if (!stillConfirmed) throw new Error('Incoming activation request is no longer confirmed');

        const stillActive = db.prepare(`
          SELECT 1 FROM project_activations a
          WHERE a.id = ? AND a.session_id = ? AND a.project_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM session_lifecycle_events e
              WHERE e.activation_id = a.id AND e.event_type = 'activation_ended'
            )
        `).get(outgoing.id, outgoing.sessionId, outgoing.projectId);
        if (!stillActive) throw new Error('Outgoing Project Activation is no longer active');

        if (db.prepare(
          'SELECT 1 FROM outgoing_checkpoints WHERE incoming_activation_request_id = ?',
        ).get(request)) {
          throw new Error('Incoming activation request already has an outgoing checkpoint');
        }

        const lifecycleSequence = db.prepare(
          'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM session_lifecycle_events WHERE session_id = ?',
        ).get(incoming.sessionId).sequence;
        db.prepare(`
          INSERT INTO outgoing_checkpoints
            (id, session_id, project_id, outgoing_activation_id,
             incoming_activation_request_id, handover_snapshot_id,
             project_event_sequence, project_event_id, project_event_at,
             project_record_count, project_event_count, lifecycle_event_sequence,
             checkpointed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          checkpointId, incoming.sessionId, outgoing.projectId, outgoing.id,
          request, outgoing.handoverSnapshotId, boundary.eventSequence,
          boundary.lastEventId, boundary.lastEventAt, boundary.recordCount,
          boundary.eventCount, lifecycleSequence, timestamp,
        );

        appendEvent({
          sessionId: incoming.sessionId, eventType: 'activation_checkpointed',
          projectId: outgoing.projectId, activationRequestId: request,
          activationId: outgoing.id, handoverSnapshotId: outgoing.handoverSnapshotId,
          checkpointId, summary: 'Outgoing activation checkpointed at project event sequence '
            + boundary.eventSequence, occurredAt: timestamp,
        });
        appendEvent({
          sessionId: incoming.sessionId, eventType: 'activation_ended',
          projectId: outgoing.projectId, activationRequestId: request,
          activationId: outgoing.id, handoverSnapshotId: outgoing.handoverSnapshotId,
          checkpointId, summary: 'Outgoing Project Activation ended after checkpoint',
          occurredAt: timestamp,
        });
      });

      return this.listCheckpoints(incoming.sessionId).find((item) => item.id === checkpointId);
    },

    async confirmProjectActivation({ requestId, confirmationToken }) {
      ensureOpen();
      const request = requiredText(requestId, 'requestId');
      const token = requiredText(confirmationToken, 'confirmationToken');
      const pending = db.prepare(`
        SELECT r.id, r.session_id AS sessionId, r.project_id AS projectId
        FROM activation_requests r
        WHERE r.id = ?
          AND NOT EXISTS (
            SELECT 1 FROM activation_confirmations c WHERE c.activation_request_id = r.id
          )
      `).get(request);
      if (!pending) throw new Error('Pending activation request not found or already confirmed');

      // The injected authority is established by the trusted application composition
      // root. Callers cannot supply actor/project claims directly to this lifecycle API.
      const verified = await confirmationAuthority.consume(token, {
        requestId: pending.id,
        sessionId: pending.sessionId,
        projectId: pending.projectId,
      });
      if (!verified || verified.requestId !== pending.id
        || verified.sessionId !== pending.sessionId
        || verified.projectId !== pending.projectId
        || typeof verified.actorId !== 'string' || !verified.actorId.trim()
        || typeof verified.method !== 'string' || !verified.method.trim()
        || typeof verified.authorityReference !== 'string' || !verified.authorityReference.trim()
        || typeof verified.confirmedAt !== 'string' || !verified.confirmedAt.trim()) {
        throw new Error('Trusted confirmation authority returned invalid or mismatched confirmation evidence');
      }

      withTransaction(db, () => {
        const stillPending = db.prepare(`
          SELECT 1 FROM activation_requests r
          WHERE r.id = ?
            AND NOT EXISTS (
              SELECT 1 FROM activation_confirmations c WHERE c.activation_request_id = r.id
            )
        `).get(request);
        if (!stillPending) throw new Error('Activation request was already confirmed');
        db.prepare(`
          INSERT INTO activation_confirmations
            (id, activation_request_id, session_id, project_id, actor_id,
             confirmation_method, authority_reference, confirmed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), pending.id, pending.sessionId, pending.projectId,
          verified.actorId.trim(), verified.method.trim(),
          verified.authorityReference.trim(), verified.confirmedAt.trim(),
        );
        appendEvent({
          sessionId: pending.sessionId, eventType: 'project_confirmed',
          projectId: pending.projectId, activationRequestId: pending.id,
          summary: 'Authenticated user confirmed project ' + pending.projectId,
          occurredAt: verified.confirmedAt.trim(),
        });
      });
      return {
        requestId: pending.id, sessionId: pending.sessionId,
        projectId: pending.projectId, actorId: verified.actorId.trim(),
        method: verified.method.trim(), confirmedAt: verified.confirmedAt.trim(),
      };
    },

    async activateProject({ requestId, providerAdapter }) {
      ensureOpen();
      const request = requiredText(requestId, 'requestId');
      const activationRequest = db.prepare(`
        SELECT r.id, r.session_id AS sessionId, r.project_id AS projectId
        FROM activation_requests r
        JOIN activation_confirmations c ON c.activation_request_id = r.id
        WHERE r.id = ?
      `).get(request);
      if (!activationRequest) {
        throw new Error('Activation request requires trusted user confirmation before delivery');
      }
      const { sessionId: session, projectId: project } = activationRequest;
      if (!this.getSession(session)) throw new Error('Session not found: ' + session);
      if (!continuityStore.getProject(project)) throw new Error('Project not found: ' + project);
      if (this.getActiveActivation(session)) {
        throw new Error('Outgoing Project Activation must be checkpointed before incoming activation delivery');
      }
      const requestContext = db.prepare(`
        SELECT activation_id AS outgoingActivationId
        FROM session_lifecycle_events
        WHERE activation_request_id = ? AND event_type = 'activation_requested'
      `).get(request);
      if (requestContext?.outgoingActivationId
        && !db.prepare(`
          SELECT 1 FROM outgoing_checkpoints
          WHERE incoming_activation_request_id = ?
            AND outgoing_activation_id = ?
        `).get(request, requestContext.outgoingActivationId)) {
        throw new Error('Project switch requires an outgoing activation checkpoint');
      }
      if (!providerAdapter || typeof providerAdapter.deliver !== 'function'
        || !providerAdapter.capabilities || providerAdapter.capabilities.contextDelivery !== true) {
        throw new TypeError('providerAdapter must support context delivery');
      }
      if (db.prepare(
        'SELECT 1 FROM context_delivery_intents WHERE activation_request_id = ? LIMIT 1',
      ).get(request)) {
        throw new Error('Delivery intent already exists; automatic retry is prohibited');
      }
      if (db.prepare(
        'SELECT 1 FROM context_delivery_attempts WHERE activation_request_id = ? LIMIT 1',
      ).get(request)) {
        throw new Error('Activation request already has a recorded delivery outcome');
      }

      const handover = continuityStore.buildHandover(project);
      const handoverId = randomUUID();
      const deliveryId = randomUUID();
      const generatedAt = requiredText(handover.generatedAt, 'handover.generatedAt');
      withTransaction(db, () => {
        const active = db.prepare(`
          SELECT 1 FROM project_activations a
          WHERE a.session_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM session_lifecycle_events e
              WHERE e.activation_id = a.id AND e.event_type = 'activation_ended'
            )
          LIMIT 1
        `).get(session);
        if (active) {
          throw new Error('Session already has an active Project Activation; switching is not yet supported');
        }
        const priorIntent = db.prepare(
          'SELECT 1 FROM context_delivery_intents WHERE activation_request_id = ? LIMIT 1',
        ).get(request);
        if (priorIntent) {
          throw new Error('Delivery intent already exists; automatic retry is prohibited');
        }
        const priorAttempt = db.prepare(
          'SELECT 1 FROM context_delivery_attempts WHERE activation_request_id = ? LIMIT 1',
        ).get(request);
        if (priorAttempt) throw new Error('Activation request already has a recorded delivery outcome');

        db.prepare(`
          INSERT INTO handover_snapshots
            (id, session_id, activation_request_id, project_id, format,
             history_boundary, payload_json, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          handoverId, session, request, project, handover.format,
          handover.lastRecordedActivityAt, JSON.stringify(handover), generatedAt,
        );
        db.prepare(`
          INSERT INTO context_delivery_intents
            (id, activation_request_id, handover_snapshot_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(deliveryId, request, handoverId, generatedAt);
        appendEvent({
          sessionId: session, eventType: 'handover_prepared', projectId: project,
          activationRequestId: request, handoverSnapshotId: handoverId,
          summary: 'Fresh handover prepared for project ' + project,
          occurredAt: generatedAt,
        });
        appendEvent({
          sessionId: session, eventType: 'delivery_intent_persisted', projectId: project,
          activationRequestId: request, handoverSnapshotId: handoverId,
          summary: 'Delivery intent persisted: ' + deliveryId,
          occurredAt: generatedAt,
        });
      });

      let delivery;
      try {
        delivery = await providerAdapter.deliver({
          deliveryId,
          idempotencyKey: deliveryId,
          handover: { id: handoverId, projectId: project, payload: handover },
          activationRequestId: request,
        });
      } catch {
        delivery = null;
      }

      const matches = delivery
        && delivery.deliveryId === deliveryId
        && delivery.activationRequestId === request
        && delivery.handoverId === handoverId
        && typeof delivery.attemptId === 'string'
        && delivery.attemptId.trim().length > 0;
      const validOutcome = matches
        && ['acknowledged', 'failed', 'unknown'].includes(delivery.outcome);
      const acknowledged = validOutcome && delivery.outcome === 'acknowledged'
        && typeof delivery.acknowledgementLevel === 'string'
        && delivery.acknowledgementLevel === providerAdapter.capabilities.acknowledgementLevel;
      const outcome = acknowledged ? 'acknowledged'
        : validOutcome && delivery.outcome === 'failed' ? 'failed' : 'unknown';
      const providerAttemptReference = matches ? delivery.attemptId : null;
      const attemptId = randomUUID();
      const attemptedAt = new Date().toISOString();
      let activation = null;

      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO context_delivery_attempts
            (id, activation_request_id, handover_snapshot_id, outcome,
             acknowledgement_level, provider_reference, attempted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          attemptId, request, handoverId, outcome,
          acknowledged ? delivery.acknowledgementLevel : null,
          delivery?.providerReference ?? providerAttemptReference, attemptedAt,
        );
        appendEvent({
          sessionId: session,
          eventType: outcome === 'acknowledged' ? 'delivery_acknowledged'
            : outcome === 'failed' ? 'delivery_failed' : 'delivery_unknown',
          projectId: project, activationRequestId: request,
          handoverSnapshotId: handoverId, deliveryAttemptId: attemptId,
          summary: 'Provider delivery outcome: ' + outcome + ' for delivery ' + deliveryId,
          occurredAt: attemptedAt,
        });

        if (acknowledged) {
          const activationId = randomUUID();
          db.prepare(`
            INSERT INTO project_activations
              (id, session_id, project_id, activation_request_id,
               handover_snapshot_id, delivery_attempt_id, activated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(activationId, session, project, request, handoverId, attemptId, attemptedAt);
          appendEvent({
            sessionId: session, eventType: 'project_activated', projectId: project,
            activationRequestId: request, activationId, handoverSnapshotId: handoverId,
            deliveryAttemptId: attemptId,
            summary: 'Project ' + project + ' activated after acknowledged delivery',
            occurredAt: attemptedAt,
          });
          activation = {
            id: activationId, sessionId: session, projectId: project,
            activationRequestId: request, handoverSnapshotId: handoverId,
            deliveryAttemptId: attemptId, activatedAt: attemptedAt,
          };
        }
      });

      return {
        status: acknowledged ? 'active' : 'blocked',
        reason: acknowledged ? null : outcome,
        activation, handoverId, deliveryAttemptId: attemptId,
      };
    },

    close() {
      if (!closed) { db.close(); closed = true; }
    },
  };
}
