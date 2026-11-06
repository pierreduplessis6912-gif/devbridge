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
  const provider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged'] });

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

    // Marker creation does not end or interrupt the activation. The next
    // continuation is separately gated by SLA-08 until fresh context is acknowledged.
    assert.equal(firstLifecycle.getActiveActivation('staleness-session-one').id, first.activation.id);
    assert.throws(() => firstLifecycle.recordContribution({
      id: 'staleness-record-one',
      sessionId: 'staleness-session-one',
      category: 'ai_contribution',
      content: 'This continuation must wait for context refresh.',
      originType: 'ai',
      sourceRef: 'session-one-follow-up',
      recordedAt: '2026-11-06T12:01:00.000Z',
    }), /stale Project context must be refreshed/);
    assert.equal(firstLifecycle.getActiveActivation('staleness-session-one').id, first.activation.id);

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


test('SLA-07: a contribution arriving during handover delivery marks the new activation stale on activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-staleness-during-delivery-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });
  const secondLifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });

  const activate = async (lifecycle, sessionId, requestId, projectId, providerAdapter) => {
    lifecycle.requestProjectActivation({ sessionId, projectId, requestId });
    await lifecycle.confirmProjectActivation({
      requestId,
      confirmationToken: authority.issue({ requestId, sessionId, projectId }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter });
  };

  try {
    store.createProject({ id: 'delivery-race-project', name: 'Delivery Race Project' });
    firstLifecycle.createSession({ id: 'delivery-race-session-one' });
    secondLifecycle.createSession({ id: 'delivery-race-session-two' });

    const first = await activate(
      firstLifecycle,
      'delivery-race-session-one',
      'delivery-race-request-one',
      'delivery-race-project',
      createSimulatedProvider(),
    );
    assert.equal(first.status, 'active');

    const secondProvider = createSimulatedProvider();
    let interveningContribution;
    const providerDuringDelivery = {
      capabilities: secondProvider.capabilities,
      async deliver(request) {
        // This happens after Session Two's handover has been persisted but
        // before its activation has been committed.
        interveningContribution = firstLifecycle.recordContribution({
          id: 'delivery-race-record-one',
          sessionId: 'delivery-race-session-one',
          category: 'user_contribution',
          content: 'A contribution arrived while Session Two handover was being delivered.',
          originType: 'user',
          sourceRef: 'session-one-during-delivery',
          recordedAt: '2026-11-06T12:10:00.000Z',
        });
        return secondProvider.deliver(request);
      },
    };

    const second = await activate(
      secondLifecycle,
      'delivery-race-session-two',
      'delivery-race-request-two',
      'delivery-race-project',
      providerDuringDelivery,
    );
    assert.equal(second.status, 'active');
    assert.ok(interveningContribution);

    const markers = secondLifecycle.listStalenessMarkers('delivery-race-session-two');
    assert.equal(markers.length, 1);
    assert.equal(markers[0].targetActivationId, second.activation.id);
    assert.equal(markers[0].targetHandoverSnapshotId, second.handoverId);
    assert.equal(markers[0].newerRecordId, interveningContribution.id);
    assert.equal(markers[0].sourceSessionId, 'delivery-race-session-one');
    assert.equal(markers[0].sourceActivationId, first.activation.id);
    assert.ok(markers[0].newerEventSequence > markers[0].targetHandoverEventSequence);
    assert.equal(secondLifecycle.getActiveActivation('delivery-race-session-two').id, second.activation.id);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('SLA-08: stale activation pauses its next continuation until an acknowledged fresh handover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-refresh-success-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged', 'acknowledged'] });

  const activate = async (lifecycle, sessionId, requestId, projectId) => {
    lifecycle.requestProjectActivation({ sessionId, projectId, requestId });
    await lifecycle.confirmProjectActivation({
      requestId, confirmationToken: authority.issue({ requestId, sessionId, projectId }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({ id: 'refresh-project', name: 'Refresh Project' });
    firstLifecycle.createSession({ id: 'refresh-session-one' });
    secondLifecycle.createSession({ id: 'refresh-session-two' });
    const first = await activate(firstLifecycle, 'refresh-session-one', 'refresh-request-one', 'refresh-project');
    const second = await activate(secondLifecycle, 'refresh-session-two', 'refresh-request-two', 'refresh-project');
    assert.equal(first.status, 'active');
    assert.equal(second.status, 'active');

    const newer = secondLifecycle.recordContribution({
      id: 'refresh-newer-record', sessionId: 'refresh-session-two',
      category: 'decision', content: 'A newer project decision.',
      originType: 'user', recordedAt: '2026-11-06T12:20:00.000Z',
    });
    const originalMarkers = firstLifecycle.listStalenessMarkers('refresh-session-one');
    assert.equal(originalMarkers.length, 1);
    assert.equal(originalMarkers[0].newerRecordId, newer.id);
    assert.throws(() => firstLifecycle.recordContribution({
      id: 'refresh-blocked-record', sessionId: 'refresh-session-one',
      category: 'ai_contribution', content: 'Must not continue before refresh.',
      originType: 'ai',
    }), /stale Project context must be refreshed/);

    const refreshed = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-session-one', providerAdapter: provider,
    });
    assert.equal(refreshed.status, 'refreshed');
    assert.equal(refreshed.activationId, first.activation.id);
    assert.ok(refreshed.deliveredEventSequence > originalMarkers[0].targetHandoverEventSequence);
    assert.equal(refreshed.remainingStalenessMarkers.length, 0);
    assert.equal(firstLifecycle.listStalenessMarkers('refresh-session-one').length, 1);
    assert.equal(firstLifecycle.listUnaddressedStalenessMarkers('refresh-session-one').length, 0);
    assert.equal(firstLifecycle.getActiveActivation('refresh-session-one').id, first.activation.id);
    assert.equal(firstLifecycle.getActiveActivation('refresh-session-one').handoverSnapshotId, first.handoverId);
    assert.deepEqual(firstLifecycle.listRefreshAttempts('refresh-session-one').map((item) => item.outcome), ['acknowledged']);

    const continued = firstLifecycle.recordContribution({
      id: 'refresh-after-ack-record', sessionId: 'refresh-session-one',
      category: 'ai_contribution', content: 'Continuation after acknowledged refresh.',
      originType: 'ai',
    });
    assert.equal(store.getRecord(continued.id).activationId, first.activation.id);

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => inspect.prepare("UPDATE activation_refresh_intents SET created_at = 'changed'").run(),
        /append-only/,
      );
      assert.throws(
        () => inspect.prepare("DELETE FROM activation_refresh_attempts").run(),
        /append-only/,
      );
    } finally { inspect.close(); }
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLA-08: a definitive failed refresh can be explicitly prepared again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-refresh-outcomes-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged', 'failed', 'acknowledged'] });

  const activate = async (lifecycle, sessionId, requestId) => {
    lifecycle.requestProjectActivation({ sessionId, projectId: 'refresh-outcome-project', requestId });
    await lifecycle.confirmProjectActivation({
      requestId, confirmationToken: authority.issue({ requestId, sessionId, projectId: 'refresh-outcome-project' }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({ id: 'refresh-outcome-project', name: 'Refresh Outcome Project' });
    firstLifecycle.createSession({ id: 'refresh-outcome-one' });
    secondLifecycle.createSession({ id: 'refresh-outcome-two' });
    const first = await activate(firstLifecycle, 'refresh-outcome-one', 'refresh-outcome-request-one');
    await activate(secondLifecycle, 'refresh-outcome-two', 'refresh-outcome-request-two');
    secondLifecycle.recordContribution({
      id: 'refresh-outcome-newer', sessionId: 'refresh-outcome-two',
      category: 'status', content: 'New status.', originType: 'user',
    });

    const failed = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-outcome-one', providerAdapter: provider,
    });
    assert.equal(failed.status, 'blocked');
    assert.equal(failed.reason, 'failed');
    assert.equal(firstLifecycle.getActiveActivation('refresh-outcome-one').id, first.activation.id);
    assert.equal(firstLifecycle.listUnaddressedStalenessMarkers('refresh-outcome-one').length, 1);

    const recovered = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-outcome-one', providerAdapter: provider,
    });
    assert.equal(recovered.status, 'refreshed');
    assert.deepEqual(firstLifecycle.listRefreshAttempts('refresh-outcome-one').map((item) => item.outcome), ['failed', 'acknowledged']);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLA-08: a contribution arriving during refresh remains newer than its acknowledged boundary', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-refresh-race-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const baseProvider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged', 'acknowledged', 'acknowledged'] });
  const activate = async (lifecycle, sessionId, requestId) => {
    lifecycle.requestProjectActivation({ sessionId, projectId: 'refresh-race-project', requestId });
    await lifecycle.confirmProjectActivation({
      requestId, confirmationToken: authority.issue({ requestId, sessionId, projectId: 'refresh-race-project' }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: baseProvider });
  };

  try {
    store.createProject({ id: 'refresh-race-project', name: 'Refresh Race Project' });
    firstLifecycle.createSession({ id: 'refresh-race-one' });
    secondLifecycle.createSession({ id: 'refresh-race-two' });
    const first = await activate(firstLifecycle, 'refresh-race-one', 'refresh-race-request-one');
    await activate(secondLifecycle, 'refresh-race-two', 'refresh-race-request-two');
    secondLifecycle.recordContribution({
      id: 'refresh-race-initial-newer', sessionId: 'refresh-race-two',
      category: 'decision', content: 'Initial newer contribution.',
      originType: 'user',
    });

    const duringDelivery = {
      capabilities: baseProvider.capabilities,
      async deliver(request) {
        secondLifecycle.recordContribution({
          id: 'refresh-race-during-record', sessionId: 'refresh-race-two',
          category: 'change', content: 'A contribution arrived after the refresh boundary.',
          originType: 'user',
        });
        return baseProvider.deliver(request);
      },
    };
    const firstRefresh = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-race-one', providerAdapter: duringDelivery,
    });
    assert.equal(firstRefresh.status, 'stale');
    assert.equal(firstRefresh.reason, 'newer_contribution_during_refresh');
    assert.equal(firstRefresh.remainingStalenessMarkers.length, 1);
    assert.equal(firstRefresh.remainingStalenessMarkers[0].newerRecordId, 'refresh-race-during-record');
    assert.throws(() => firstLifecycle.recordContribution({
      id: 'refresh-race-blocked', sessionId: 'refresh-race-one',
      category: 'ai_contribution', content: 'Still blocked.',
      originType: 'ai',
    }), /stale Project context must be refreshed/);

    const secondRefresh = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-race-one', providerAdapter: baseProvider,
    });
    assert.equal(secondRefresh.status, 'refreshed');
    assert.equal(firstLifecycle.getActiveActivation('refresh-race-one').id, first.activation.id);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('SLA-08: unknown refresh remains unresolved and cannot be automatically replayed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-refresh-unknown-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged', 'unknown', 'acknowledged'] });
  const activate = async (lifecycle, sessionId, requestId) => {
    lifecycle.requestProjectActivation({ sessionId, projectId: 'refresh-unknown-project', requestId });
    await lifecycle.confirmProjectActivation({
      requestId, confirmationToken: authority.issue({ requestId, sessionId, projectId: 'refresh-unknown-project' }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({ id: 'refresh-unknown-project', name: 'Refresh Unknown Project' });
    firstLifecycle.createSession({ id: 'refresh-unknown-one' });
    secondLifecycle.createSession({ id: 'refresh-unknown-two' });
    await activate(firstLifecycle, 'refresh-unknown-one', 'refresh-unknown-request-one');
    await activate(secondLifecycle, 'refresh-unknown-two', 'refresh-unknown-request-two');
    secondLifecycle.recordContribution({
      id: 'refresh-unknown-newer', sessionId: 'refresh-unknown-two',
      category: 'status', content: 'A newer status.', originType: 'user',
    });

    const unknown = await firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-unknown-one', providerAdapter: provider,
    });
    assert.equal(unknown.status, 'blocked');
    assert.equal(unknown.reason, 'unknown');
    assert.equal(firstLifecycle.listRefreshAttempts('refresh-unknown-one')[0].outcome, 'unknown');
    assert.throws(() => firstLifecycle.refreshStaleActivation({
      sessionId: 'refresh-unknown-one', providerAdapter: provider,
    }), /unresolved; automatic retry is prohibited/);
    assert.equal(firstLifecycle.listRefreshAttempts('refresh-unknown-one').length, 1);
    assert.equal(firstLifecycle.listUnaddressedStalenessMarkers('refresh-unknown-one').length, 1);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
