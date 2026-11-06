import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const RECORD_CATEGORIES = Object.freeze([
  'requirement',
  'decision',
  'agreement',
  'commitment',
  'status',
  'user_contribution',
  'ai_contribution',
  'proposal',
  'disagreement',
  'change',
  'reference',
]);

const ORIGIN_TYPES = new Set(['user', 'ai', 'connected_source']);

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new TypeError(`${field} must be a string when supplied`);
  }
  return value.trim() || null;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function withTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

export function openStore(databasePath) {
  const path = requiredText(databasePath, 'databasePath');
  const db = new DatabaseSync(path);

  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');

    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 3) {
      throw new Error(`Database schema version ${version} is newer than this application supports`);
    }

    if (version === 0) {
      withTransaction(db, () => {
        db.exec(`
          CREATE TABLE projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL CHECK (length(trim(name)) > 0),
            purpose TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          ) STRICT;

          CREATE TABLE project_records (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            category TEXT NOT NULL CHECK (category IN (
              'requirement', 'decision', 'agreement', 'commitment', 'status',
              'user_contribution', 'ai_contribution', 'proposal',
              'disagreement', 'change', 'reference'
            )),
            content TEXT NOT NULL CHECK (length(trim(content)) > 0),
            origin_type TEXT NOT NULL CHECK (origin_type IN ('user', 'ai', 'connected_source')),
            origin_label TEXT,
            source_ref TEXT,
            status_text TEXT,
            recorded_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX project_records_project_time
            ON project_records(project_id, recorded_at, id);

          CREATE TABLE record_links (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            from_record_id TEXT NOT NULL REFERENCES project_records(id),
            to_record_id TEXT NOT NULL REFERENCES project_records(id),
            relationship TEXT NOT NULL CHECK (relationship IN ('relates_to', 'supersedes', 'contradicts', 'corrects')),
            created_at TEXT NOT NULL,
            CHECK (from_record_id <> to_record_id),
            UNIQUE(from_record_id, to_record_id, relationship)
          ) STRICT;

          CREATE TABLE project_events (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            event_type TEXT NOT NULL,
            actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'ai', 'connected_source')),
            actor_label TEXT,
            record_id TEXT REFERENCES project_records(id),
            summary TEXT NOT NULL,
            occurred_at TEXT NOT NULL
          ) STRICT;

          CREATE INDEX project_events_project_time
            ON project_events(project_id, occurred_at, id);

          CREATE TRIGGER project_records_no_update
          BEFORE UPDATE ON project_records
          BEGIN
            SELECT RAISE(ABORT, 'project records are append-only');
          END;

          CREATE TRIGGER project_records_no_delete
          BEFORE DELETE ON project_records
          BEGIN
            SELECT RAISE(ABORT, 'project records are append-only');
          END;

          CREATE TRIGGER project_events_no_update
          BEFORE UPDATE ON project_events
          BEGIN
            SELECT RAISE(ABORT, 'project events are append-only');
          END;

          CREATE TRIGGER project_events_no_delete
          BEFORE DELETE ON project_events
          BEGIN
            SELECT RAISE(ABORT, 'project events are append-only');
          END;

          PRAGMA user_version = 1;
        `);
      });
    }

    // Version 2 hardens relationship integrity without rebuilding existing tables.
    if (version < 2) {
      withTransaction(db, () => {
        db.exec(`
          CREATE TRIGGER record_links_same_project_insert
          BEFORE INSERT ON record_links
          BEGIN
            SELECT CASE
              WHEN NOT EXISTS (
                SELECT 1 FROM project_records
                WHERE id = NEW.from_record_id AND project_id = NEW.project_id
              ) OR NOT EXISTS (
                SELECT 1 FROM project_records
                WHERE id = NEW.to_record_id AND project_id = NEW.project_id
              )
              THEN RAISE(ABORT, 'record links must connect records within the same project')
            END;
          END;

          CREATE TRIGGER record_links_no_update
          BEFORE UPDATE ON record_links
          BEGIN
            SELECT RAISE(ABORT, 'record links are append-only');
          END;

          CREATE TRIGGER record_links_no_delete
          BEFORE DELETE ON record_links
          BEGIN
            SELECT RAISE(ABORT, 'record links are append-only');
          END;

          PRAGMA user_version = 2;
        `);
      });
    }

    // Version 3 adds a durable, per-project event sequence for checkpoint boundaries.
    if (version < 3) {
      withTransaction(db, () => {
        db.exec(`
          DROP TRIGGER IF EXISTS project_events_no_update;
          ALTER TABLE project_events
            ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0;

          UPDATE project_events AS target
          SET event_sequence = (
            SELECT COUNT(*)
            FROM project_events AS prior
            WHERE prior.project_id = target.project_id
              AND prior.rowid <= target.rowid
          );

          CREATE UNIQUE INDEX project_events_project_sequence
            ON project_events(project_id, event_sequence);

          CREATE TRIGGER project_events_sequence_insert
          BEFORE INSERT ON project_events
          WHEN NEW.event_sequence <> COALESCE((
            SELECT MAX(event_sequence) + 1
            FROM project_events WHERE project_id = NEW.project_id
          ), 1)
          BEGIN
            SELECT RAISE(ABORT, 'project event sequence must be the next project sequence');
          END;

          CREATE TRIGGER project_events_no_update
          BEFORE UPDATE ON project_events
          BEGIN
            SELECT RAISE(ABORT, 'project events are append-only');
          END;

          PRAGMA user_version = 3;
        `);
      });
    }
  } catch (error) {
    db.close();
    throw error;
  }

  let closed = false;
  const ensureOpen = () => {
    if (closed) throw new Error('Store is closed');
  };

  return {
    createProject({ id = randomUUID(), name, purpose = null }) {
      ensureOpen();
      const projectId = requiredText(id, 'id');
      const projectName = requiredText(name, 'name');
      const projectPurpose = optionalText(purpose, 'purpose');
      const now = new Date().toISOString();

      withTransaction(db, () => {
        db.prepare(`
          INSERT INTO projects (id, name, purpose, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(projectId, projectName, projectPurpose, now, now);

        db.prepare(`
          INSERT INTO project_events
            (id, project_id, event_type, actor_type, actor_label, record_id, summary, occurred_at, event_sequence)
          VALUES (?, ?, 'project_created', 'user', NULL, NULL, ?, ?, 1)
        `).run(randomUUID(), projectId, `Project created: ${projectName}`, now);
      });

      return this.getProject(projectId);
    },

    getProject(projectId) {
      ensureOpen();
      const id = requiredText(projectId, 'projectId');
      return db.prepare(`
        SELECT id, name, purpose, created_at AS createdAt, updated_at AS updatedAt
        FROM projects WHERE id = ?
      `).get(id) ?? null;
    },

    listProjects() {
      ensureOpen();
      return db.prepare(`
        SELECT id, name, purpose, created_at AS createdAt, updated_at AS updatedAt
        FROM projects ORDER BY updated_at DESC, id
      `).all();
    },

    appendRecord({
      id = randomUUID(),
      projectId,
      category,
      content,
      originType,
      originLabel = null,
      sourceRef = null,
      statusText = null,
      relatedRecords = [],
      recordedAt = new Date().toISOString(),
    }) {
      ensureOpen();
      const recordId = requiredText(id, 'id');
      const project = requiredText(projectId, 'projectId');
      const recordCategory = requiredText(category, 'category');
      if (!RECORD_CATEGORIES.includes(recordCategory)) {
        throw new TypeError(`Unsupported record category: ${recordCategory}`);
      }
      const recordContent = requiredText(content, 'content');
      if (!ORIGIN_TYPES.has(originType)) {
        throw new TypeError('originType must be user, ai or connected_source');
      }
      if (!Array.isArray(relatedRecords)) {
        throw new TypeError('relatedRecords must be an array');
      }
      const timestamp = requiredText(recordedAt, 'recordedAt');
      const label = optionalText(originLabel, 'originLabel');
      const ref = optionalText(sourceRef, 'sourceRef');
      const status = optionalText(statusText, 'statusText');
      const links = relatedRecords.map((link) => {
        if (!link || typeof link !== 'object') throw new TypeError('Each related record must be an object');
        const targetId = requiredText(link.recordId, 'relatedRecords.recordId');
        const relationship = requiredText(link.relationship, 'relatedRecords.relationship');
        if (!['relates_to', 'supersedes', 'contradicts', 'corrects'].includes(relationship)) {
          throw new TypeError(`Unsupported record relationship: ${relationship}`);
        }
        if (targetId === recordId) throw new TypeError('A record cannot link to itself');
        return { targetId, relationship };
      });

      withTransaction(db, () => {
        if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(project)) {
          throw new Error(`Project not found: ${project}`);
        }

        db.prepare(`
          INSERT INTO project_records
            (id, project_id, category, content, origin_type, origin_label, source_ref, status_text, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(recordId, project, recordCategory, recordContent, originType, label, ref, status, timestamp);

        const insertLink = db.prepare(`
          INSERT INTO record_links
            (id, project_id, from_record_id, to_record_id, relationship, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const link of links) {
          const target = db.prepare(`
            SELECT project_id FROM project_records WHERE id = ?
          `).get(link.targetId);
          if (!target || target.project_id !== project) {
            throw new Error(`Related record does not exist in this project: ${link.targetId}`);
          }
          insertLink.run(randomUUID(), project, recordId, link.targetId, link.relationship, timestamp);
        }

        db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(timestamp, project);
        const eventSequence = db.prepare(
          'SELECT COALESCE(MAX(event_sequence), 0) + 1 AS sequence FROM project_events WHERE project_id = ?',
        ).get(project).sequence;
        db.prepare(`
          INSERT INTO project_events
            (id, project_id, event_type, actor_type, actor_label, record_id, summary, occurred_at, event_sequence)
          VALUES (?, ?, 'record_added', ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), project, originType, label, recordId, `Recorded ${recordCategory}`, timestamp, eventSequence);
      });

      return this.getRecord(recordId);
    },

    getProjectHistoryBoundary(projectId) {
      ensureOpen();
      const project = requiredText(projectId, 'projectId');
      const boundary = db.prepare(`
        SELECT p.id AS projectId,
          (SELECT COUNT(*) FROM project_records r WHERE r.project_id = p.id) AS recordCount,
          (SELECT COUNT(*) FROM project_events e WHERE e.project_id = p.id) AS eventCount,
          (SELECT COALESCE(MAX(e.event_sequence), 0)
            FROM project_events e WHERE e.project_id = p.id) AS eventSequence,
          (SELECT e.id FROM project_events e
            WHERE e.project_id = p.id ORDER BY e.event_sequence DESC LIMIT 1) AS lastEventId,
          (SELECT e.occurred_at FROM project_events e
            WHERE e.project_id = p.id ORDER BY e.event_sequence DESC LIMIT 1) AS lastEventAt
        FROM projects p WHERE p.id = ?
      `).get(project);
      if (!boundary) throw new Error(`Project not found: ${project}`);
      return { ...boundary, capturedAt: new Date().toISOString() };
    },

    getRecord(recordId) {
      ensureOpen();
      const id = requiredText(recordId, 'recordId');
      return db.prepare(`
        SELECT id, project_id AS projectId, category, content,
          origin_type AS originType, origin_label AS originLabel,
          source_ref AS sourceRef, status_text AS statusText, recorded_at AS recordedAt
        FROM project_records WHERE id = ?
      `).get(id) ?? null;
    },

    listRecords(projectId, { limit = 100, before = null } = {}) {
      ensureOpen();
      const project = requiredText(projectId, 'projectId');
      const count = positiveInteger(limit, 'limit');
      const cursor = optionalText(before, 'before');
      const rows = cursor
        ? db.prepare(`
            SELECT id, project_id AS projectId, category, content,
              origin_type AS originType, origin_label AS originLabel,
              source_ref AS sourceRef, status_text AS statusText, recorded_at AS recordedAt
            FROM project_records
            WHERE project_id = ? AND recorded_at < ?
            ORDER BY recorded_at DESC, id DESC LIMIT ?
          `).all(project, cursor, count)
        : db.prepare(`
            SELECT id, project_id AS projectId, category, content,
              origin_type AS originType, origin_label AS originLabel,
              source_ref AS sourceRef, status_text AS statusText, recorded_at AS recordedAt
            FROM project_records
            WHERE project_id = ?
            ORDER BY recorded_at DESC, id DESC LIMIT ?
          `).all(project, count);
      return rows.reverse();
    },

    listEvents(projectId, { limit = 100 } = {}) {
      ensureOpen();
      const project = requiredText(projectId, 'projectId');
      const count = positiveInteger(limit, 'limit');
      return db.prepare(`
        SELECT id, project_id AS projectId, event_type AS eventType,
          actor_type AS actorType, actor_label AS actorLabel,
          record_id AS recordId, summary, occurred_at AS occurredAt
        FROM project_events
        WHERE project_id = ?
        ORDER BY occurred_at DESC, id DESC LIMIT ?
      `).all(project, count).reverse();
    },

    buildHandover(projectId, { recordLimit = 50, eventLimit = recordLimit } = {}) {
      ensureOpen();
      const project = this.getProject(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const limit = positiveInteger(recordLimit, 'recordLimit');
      const eventCountLimit = positiveInteger(eventLimit, 'eventLimit');
      const recordCountKnown = db.prepare(
        'SELECT COUNT(*) AS count FROM project_records WHERE project_id = ?',
      ).get(project.id).count;
      const eventCountKnown = db.prepare(
        'SELECT COUNT(*) AS count FROM project_events WHERE project_id = ?',
      ).get(project.id).count;
      const records = this.listRecords(project.id, { limit });
      const events = this.listEvents(project.id, { limit: eventCountLimit });
      const includedRecordIds = new Set(records.map((record) => record.id));
      const allLinks = db.prepare(`
        SELECT id, project_id AS projectId,
          from_record_id AS fromRecordId, to_record_id AS toRecordId,
          relationship, created_at AS createdAt
        FROM record_links
        WHERE project_id = ?
        ORDER BY created_at, id
      `).all(project.id);
      const relationships = allLinks
        .filter((link) => includedRecordIds.has(link.fromRecordId)
          || includedRecordIds.has(link.toRecordId))
        .map((link) => ({
          ...link,
          fromIncluded: includedRecordIds.has(link.fromRecordId),
          toIncluded: includedRecordIds.has(link.toRecordId),
        }));
      const lastEvent = db.prepare(`
        SELECT occurred_at AS occurredAt FROM project_events
        WHERE project_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1
      `).get(project.id) ?? null;

      const recordIdsByCategory = Object.fromEntries(
        RECORD_CATEGORIES.map((category) => [
          category,
          records.filter((record) => record.category === category).map((record) => record.id),
        ]),
      );
      const unresolvedRecordIds = records
        .filter((record) => record.statusText === 'unresolved')
        .map((record) => record.id);
      const reportedStatusRecordIds = records
        .filter((record) => record.category === 'status' && record.statusText !== 'unresolved')
        .map((record) => record.id);
      const supersededRecordIds = [...new Set(
        allLinks
          .filter((link) => link.relationship === 'supersedes'
            && includedRecordIds.has(link.toRecordId))
          .map((link) => link.toRecordId),
      )];

      return {
        format: 'devbridge-handover-v2',
        generatedAt: new Date().toISOString(),
        project,
        kernel: {
          projectId: project.id,
          name: project.name,
          purpose: project.purpose,
          principles: [],
          principlePolicy: 'Principles are included only after the user explicitly marks them as enduring project principles.',
        },
        currentState: {
          basis: 'index_of_included_records_only',
          recordIdsByCategory,
          unresolvedRecordIds,
          reportedStatusRecordIds,
          supersededRecordIds,
        },
        history: {
          records,
          relationships,
          events,
          recordCountIncluded: records.length,
          recordCountKnown,
          hasOlderRecords: recordCountKnown > records.length,
          eventCountIncluded: events.length,
          eventCountKnown,
          hasOlderEvents: eventCountKnown > events.length,
        },
        records,
        recordCountIncluded: records.length,
        recordCountKnown,
        hasOlderRecords: recordCountKnown > records.length,
        lastRecordedActivityAt: lastEvent?.occurredAt ?? null,
        completeness: 'recorded_context_only',
        notice: 'This handover contains information recorded by DevBridge only. It may omit private conversations, disconnected sources, or activity never submitted or observed. Current-state indexes cover included records only; status reports are not independently verified.',
      };
    },

    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
