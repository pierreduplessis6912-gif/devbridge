import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';
import { createSimulatedConfirmationAuthority } from '../test-support/simulated-confirmation-authority.mjs';

test('SLA-07: a newer Project contribution marks other older active activations potentially stale', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-staleness-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });
  const secondLifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });
  const provider = createSimulatedProvider();

  const activate = async (lifecycle, sessionId, requestId, projectId) => {
    lifecycle.requestProjectActivation({ sessionId, projectId, requestId });
    await lifecycle.confirmProjectActivation({
      requestId,
      confirmationToken: authority.issue({ requestId, sessionId, projectId }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({ id: 'staleness-project', name: 'Shared Project' });
    firstLifecycle.createSession({ id: 'staleness-session-one' });
    secondLifecycle.createSession({ id: 'staleness-session-two' });

    const first = await activate(
      firstLifecycle, 'staleness-session-one', 'staleness-request-one', 'staleness-project',
    );
    const second = await activate(
      secondLifecycle, 'staleness-session-two', 'staleness-request-two', 'staleness-project',
    );
    assert.equal(first.status, 'active');
    assert.equal(second.status, 'active');

    const inspect = new DatabaseSync(databasePath);
    let firstBoundary;
    let secondBoundary;
    try {
      const handovers = inspect.prepare(`
        SELECT r.session_id AS sessionId,
          h.project_event_sequence AS eventSequence,
          h.payload_json AS payload
        FROM handover_snapshots h
        JOIN activation_requests r ON r.id = h.activation_request_id
        ORDER BY h.rowid
      `).all().map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
      firstBoundary = handovers[0].eventSequence;
      secondBoundary = handovers[1].eventSequence;
      assert.equal(firstBoundary, secondBoundary);
      assert.equal(handovers[0].payload.historyBoundary.eventSequence, firstBoundary);
      assert.equal(handovers[1].payload.historyBoundary.eventSequence, secondBoundary);
    } finally {
      inspect.close();
    }

    const fromSecond = secondLifecycle.recordContribution({
      id: 'staleness-record-two',
      sessionId: 'staleness-session-two',
      category: 'user_contribution',
      content: 'A new contribution from Session Two.',
      originType: 'user',
      sourceRef: 'session-two-input',
      recordedAt: '2026-11-06T12:00:00.000Z',
    });
    const firstMarkers = firstLifecycle.listStalenessMarkers('staleness-session-one');
    const secondMarkersBefore = secondLifecycle.listStalenessMarkers('staleness-session-two');

    assert.equal(firstMarkers.length, 1);
    assert.equal(firstMarkers[0].projectId, 'staleness-project');
    assert.equal(firstMarkers[0].targetSessionId, 'staleness-session-one');
    assert.equal(firstMarkers[0].targetActivationId, first.activation.id);
    assert.equal(firstMarkers[0].targetHandoverSnapshotId, first.handoverId);
    assert.equal(firstMarkers[0].targetHandoverEventSequence, firstBoundary);
    assert.ok(firstMarkers[0].newerEventSequence > firstMarkers[0].targetHandoverEventSequence);
    assert.equal(firstMarkers[0].newerRecordId, fromSecond.id);
    assert.equal(firstMarkers[0].sourceSessionId, 'staleness-session-two');
    assert.equal(firstMarkers[0].sourceActivationId, second.activation.id);
    assert.equal(secondMarkersBefore.length, 0);

    // SLA-07 is a marker, not an interruption: Session One remains active
    // and may continue. Its own contribution must not stale itself.
    assert.equal(firstLifecycle.getActiveActivation('staleness-session-one').id, first.activation.id);
    const fromFirst = firstLifecycle.recordContribution({
      id: 'staleness-record-one',
      sessionId: 'staleness-session-one',
      category: 'ai_contribution',
      content: 'Session One continues after the marker.',
      originType: 'ai',
      sourceRef: 'session-one-follow-up',
      recordedAt: '2026-11-06T12:01:00.000Z',
    });
    assert.equal(firstLifecycle.getActiveActivation('staleness-session-one').id, first.activation.id);

    const secondMarkers = secondLifecycle.listStalenessMarkers('staleness-session-two');
    assert.equal(secondMarkers.length, 1);
    assert.equal(secondMarkers[0].targetActivationId, second.activation.id);
    assert.equal(secondMarkers[0].newerRecordId, fromFirst.id);
    assert.equal(secondMarkers[0].sourceSessionId, 'staleness-session-one');
    assert.equal(secondMarkers[0].sourceActivationId, first.activation.id);

    // Markers preserve version/provenance facts only; no conflict or winner
    // judgement is created, and marker history cannot be rewritten.
    const immutable = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => immutable.prepare(
          "UPDATE activation_staleness_markers SET marked_at = 'changed' WHERE id = ?",
        ).run(firstMarkers[0].id),
        /append-only/,
      );
      assert.throws(
        () => immutable.prepare(
          'DELETE FROM activation_staleness_markers WHERE id = ?',
        ).run(firstMarkers[0].id),
        /append-only/,
      );
    } finally {
      immutable.close();
    }

    assert.equal(store.getRecord('staleness-record-two').activationId, second.activation.id);
    assert.equal(store.getRecord('staleness-record-one').activationId, first.activation.id);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
