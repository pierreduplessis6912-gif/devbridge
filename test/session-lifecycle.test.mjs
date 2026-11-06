import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';
import { createSimulatedConfirmationAuthority } from '../test-support/simulated-confirmation-authority.mjs';

test('simulated provider declares payload acceptance, not model comprehension', () => {
  const provider = createSimulatedProvider();

  assert.deepEqual(provider.capabilities, {
    contextDelivery: true,
    acknowledgementLevel: 'payload_accepted',
    provesModelComprehension: false,
  });
});

test('simulated provider returns deterministic acknowledged, failed and unknown outcomes', async () => {
  const provider = createSimulatedProvider({
    outcomes: ['acknowledged', 'failed', 'unknown'],
  });
  const handover = { id: 'handover-a-1', projectId: 'project-a' };

  const acknowledged = await provider.deliver({
    deliveryId: 'delivery-1',
    handover,
    activationRequestId: 'activation-request-1',
  });
  const failed = await provider.deliver({
    deliveryId: 'delivery-2',
    handover,
    activationRequestId: 'activation-request-2',
  });
  const unknown = await provider.deliver({
    deliveryId: 'delivery-3',
    handover,
    activationRequestId: 'activation-request-3',
  });

  assert.deepEqual(
    [acknowledged.outcome, failed.outcome, unknown.outcome],
    ['acknowledged', 'failed', 'unknown'],
  );
  assert.equal(acknowledged.acknowledgementLevel, 'payload_accepted');
  assert.equal(failed.acknowledgementLevel, null);
  assert.equal(unknown.acknowledgementLevel, null);
  assert.deepEqual(
    [acknowledged.sequence, failed.sequence, unknown.sequence],
    [1, 2, 3],
  );
  assert.equal(new Set([
    acknowledged.attemptId,
    failed.attemptId,
    unknown.attemptId,
  ]).size, 3);
  assert.equal(acknowledged.handoverId, handover.id);
  assert.equal(acknowledged.deliveryId, 'delivery-1');
  assert.equal(acknowledged.activationRequestId, 'activation-request-1');
  assert.equal(acknowledged.provesModelComprehension, false);
});

test('simulated provider echoes a delivery ID but does not claim idempotent delivery', async () => {
  const provider = createSimulatedProvider({
    outcomes: ['failed', 'acknowledged'],
  });
  const handover = { id: 'handover-b-1', projectId: 'project-b' };
  assert.equal(provider.capabilities.idempotentDelivery, undefined);

  const first = await provider.deliver({
    deliveryId: 'stable-delivery-b',
    handover,
    activationRequestId: 'activation-request-b',
  });
  const second = await provider.deliver({
    deliveryId: 'stable-delivery-b',
    handover,
    activationRequestId: 'activation-request-b',
  });

  assert.equal(first.outcome, 'failed');
  assert.equal(second.outcome, 'acknowledged');
  assert.notEqual(first.attemptId, second.attemptId);
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(first.deliveryId, 'stable-delivery-b');
  assert.equal(second.deliveryId, 'stable-delivery-b');

  await assert.rejects(
    provider.deliver({
      deliveryId: 'stable-delivery-b',
      handover,
      activationRequestId: 'activation-request-b',
    }),
    /No simulated outcome remains/,
  );
});

test('simulated provider rejects malformed delivery requests', async () => {
  const provider = createSimulatedProvider();

  await assert.rejects(
    provider.deliver({ deliveryId: 'delivery-malformed', activationRequestId: 'activation-request-1' }),
    /handover with a non-empty id is required/,
  );
  await assert.rejects(
    provider.deliver({ deliveryId: 'delivery-malformed', handover: { id: 'handover-a' } }),
    /activationRequestId is required/,
  );
});

// The main lifecycle scenarios below complement dedicated acceptance tests
// for contribution attribution, staleness/refresh, concurrent contributions,
// semantic neutrality, Cross-Project references and Session ending.
test('SLA-02: switching A to B checkpoints A and activates B only after delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-switch-project-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });

  let resolveDelivery;
  let signalDeliveryStarted;
  const deliveryStarted = new Promise((resolve) => { signalDeliveryStarted = resolve; });
  const deliveryResult = new Promise((resolve) => { resolveDelivery = resolve; });
  let capturedDelivery;
  const provider = {
    capabilities: {
      contextDelivery: true,
      acknowledgementLevel: 'payload_accepted',
      provesModelComprehension: false,
    },
    async deliver(input) {
      capturedDelivery = input;
      signalDeliveryStarted();
      return deliveryResult;
    },
  };

  const confirm = async (requestId, projectId) => lifecycle.confirmProjectActivation({
    requestId,
    confirmationToken: authority.issue({
      requestId, sessionId: 'session-switch', projectId,
    }),
  });

  try {
    store.createProject({ id: 'switch-project-a', name: 'Project A' });
    store.createProject({ id: 'switch-project-b', name: 'Project B' });
    store.appendRecord({
      id: 'switch-a-record-1', projectId: 'switch-project-a',
      category: 'requirement', content: 'A context before switching.',
      originType: 'user',
    });
    store.appendRecord({
      id: 'switch-b-record-1', projectId: 'switch-project-b',
      category: 'requirement', content: 'B context to deliver.',
      originType: 'user',
    });
    lifecycle.createSession({ id: 'session-switch', providerName: 'simulated-provider' });

    lifecycle.requestProjectActivation({
      sessionId: 'session-switch', projectId: 'switch-project-a',
      requestId: 'request-switch-a', requestedAt: '2026-11-06T10:00:00.000Z',
    });
    await confirm('request-switch-a', 'switch-project-a');
    const firstA = await lifecycle.activateProject({
      requestId: 'request-switch-a',
      providerAdapter: createSimulatedProvider({ outcomes: ['acknowledged'] }),
    });
    assert.equal(firstA.status, 'active');
    assert.equal(lifecycle.getActiveActivation('session-switch').id, firstA.activation.id);

    lifecycle.requestProjectActivation({
      sessionId: 'session-switch', projectId: 'switch-project-b',
      requestId: 'request-switch-b', requestedAt: '2026-11-06T10:01:00.000Z',
    });
    await confirm('request-switch-b', 'switch-project-b');
    const checkpoint = lifecycle.checkpointActiveActivation({
      requestId: 'request-switch-b',
    });

    assert.equal(checkpoint.outgoingActivationId, firstA.activation.id);
    assert.equal(checkpoint.projectId, 'switch-project-a');
    assert.equal(lifecycle.getActiveActivation('session-switch'), null);

    const switching = lifecycle.activateProject({
      requestId: 'request-switch-b',
      providerAdapter: provider,
    });
    await deliveryStarted;

    // The provider has received the prepared B handover but has not yet
    // acknowledged it. No B activation may exist at this point.
    assert.equal(capturedDelivery.activationRequestId, 'request-switch-b');
    assert.equal(capturedDelivery.handover.projectId, 'switch-project-b');
    assert.ok(capturedDelivery.deliveryId);
    assert.equal(capturedDelivery.idempotencyKey, capturedDelivery.deliveryId);
    assert.equal(lifecycle.getActiveActivation('session-switch'), null);
    assert.deepEqual(
      lifecycle.listActivations('session-switch').map((item) => item.projectId),
      ['switch-project-a'],
    );
    const attemptsWhilePending = lifecycle.listDeliveryAttempts('session-switch');
    assert.deepEqual(
      attemptsWhilePending.map((item) => item.outcome),
      ['acknowledged', 'unknown'],
    );
    assert.equal(attemptsWhilePending[1].activationRequestId, 'request-switch-b');
    assert.equal(attemptsWhilePending[1].handoverSnapshotId, capturedDelivery.handover.id);
    assert.equal(attemptsWhilePending[1].unresolved, 1);
    assert.equal(attemptsWhilePending[1].id, null);
    assert.deepEqual(lifecycle.listCheckpoints('session-switch'), [checkpoint]);

    resolveDelivery({
      deliveryId: capturedDelivery.deliveryId,
      activationRequestId: capturedDelivery.activationRequestId,
      handoverId: capturedDelivery.handover.id,
      attemptId: 'provider-switch-b-ack',
      providerReference: 'simulated-switch-b',
      outcome: 'acknowledged',
      acknowledgementLevel: 'payload_accepted',
    });
    const activatedB = await switching;

    assert.equal(activatedB.status, 'active');
    assert.equal(activatedB.reason, null);
    assert.equal(activatedB.activation.projectId, 'switch-project-b');
    assert.notEqual(activatedB.activation.id, firstA.activation.id);
    assert.equal(activatedB.handoverId, capturedDelivery.handover.id);
    assert.equal(lifecycle.getActiveActivation('session-switch').id,
      activatedB.activation.id);
    assert.equal(lifecycle.getActiveActivation('session-switch').projectId,
      'switch-project-b');

    const activations = lifecycle.listActivations('session-switch');
    assert.deepEqual(activations.map((item) => item.projectId), [
      'switch-project-a', 'switch-project-b',
    ]);
    assert.equal(activations[0].id, firstA.activation.id);
    assert.equal(activations[1].id, activatedB.activation.id);
    assert.equal(activations[1].handoverSnapshotId, activatedB.handoverId);

    const attempts = lifecycle.listDeliveryAttempts('session-switch');
    assert.deepEqual(attempts.map((item) => item.outcome), [
      'acknowledged', 'acknowledged',
    ]);
    assert.equal(attempts[1].activationRequestId, 'request-switch-b');
    assert.equal(attempts[1].handoverSnapshotId, activatedB.handoverId);
    assert.equal(attempts[1].deliveryId, capturedDelivery.deliveryId);

    const events = lifecycle.listEvents('session-switch');
    const checkpointEvent = events.find((event) =>
      event.eventType === 'activation_checkpointed'
      && event.activationRequestId === 'request-switch-b');
    const endedEvent = events.find((event) =>
      event.eventType === 'activation_ended'
      && event.activationId === firstA.activation.id);
    const acknowledgedEvent = events.find((event) =>
      event.eventType === 'delivery_acknowledged'
      && event.activationRequestId === 'request-switch-b');
    const activatedEvent = events.find((event) =>
      event.eventType === 'project_activated'
      && event.activationRequestId === 'request-switch-b');
    assert.ok(checkpointEvent);
    assert.ok(endedEvent);
    assert.ok(acknowledgedEvent);
    assert.ok(activatedEvent);
    assert.ok(checkpointEvent.sequence < endedEvent.sequence);
    assert.ok(endedEvent.sequence < acknowledgedEvent.sequence);
    assert.ok(acknowledgedEvent.sequence < activatedEvent.sequence);
    assert.equal(activatedEvent.activationId, activatedB.activation.id);
    assert.equal(lifecycle.listCheckpoints('session-switch').length, 1);
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('SLA-03: returning B to A creates a fresh A activation and handover', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-return-project-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({
    outcomes: ['acknowledged', 'acknowledged', 'acknowledged'],
  });

  const confirm = async (requestId, projectId) => lifecycle.confirmProjectActivation({
    requestId,
    confirmationToken: authority.issue({
      requestId, sessionId: 'session-return', projectId,
    }),
  });
  const activate = (requestId) => lifecycle.activateProject({
    requestId, providerAdapter: provider,
  });

  try {
    store.createProject({ id: 'project-a', name: 'Project A' });
    store.createProject({ id: 'project-b', name: 'Project B' });
    store.appendRecord({
      id: 'project-a-record-1', projectId: 'project-a',
      category: 'requirement', content: 'Original A context.',
      originType: 'user',
    });
    store.appendRecord({
      id: 'project-b-record-1', projectId: 'project-b',
      category: 'requirement', content: 'B context.',
      originType: 'user',
    });
    lifecycle.createSession({ id: 'session-return', providerName: 'simulated-provider' });

    lifecycle.requestProjectActivation({
      sessionId: 'session-return', projectId: 'project-a', requestId: 'request-a-first',
    });
    await confirm('request-a-first', 'project-a');
    const firstA = await activate('request-a-first');
    assert.equal(firstA.status, 'active');

    lifecycle.requestProjectActivation({
      sessionId: 'session-return', projectId: 'project-b', requestId: 'request-b',
    });
    await confirm('request-b', 'project-b');
    lifecycle.checkpointActiveActivation({ requestId: 'request-b' });
    const activatedB = await activate('request-b');
    assert.equal(activatedB.status, 'active');

    store.appendRecord({
      id: 'project-a-record-2', projectId: 'project-a',
      category: 'decision', content: 'A changed while B was active.',
      originType: 'user',
    });

    lifecycle.requestProjectActivation({
      sessionId: 'session-return', projectId: 'project-a', requestId: 'request-a-return',
    });
    await confirm('request-a-return', 'project-a');
    lifecycle.checkpointActiveActivation({ requestId: 'request-a-return' });
    const returnedA = await activate('request-a-return');
    assert.equal(returnedA.status, 'active');

    const activations = lifecycle.listActivations('session-return');
    assert.deepEqual(activations.map((item) => item.projectId), [
      'project-a', 'project-b', 'project-a',
    ]);
    assert.notEqual(activations[0].id, activations[2].id);
    assert.notEqual(activations[0].handoverSnapshotId, activations[2].handoverSnapshotId);
    assert.equal(lifecycle.getActiveActivation('session-return').id, returnedA.activation.id);
    assert.equal(lifecycle.getActiveActivation('session-return').projectId, 'project-a');

    const inspect = new DatabaseSync(databasePath);
    try {
      const snapshots = inspect.prepare(`
        SELECT id, payload_json AS payloadJson
        FROM handover_snapshots
        WHERE activation_request_id = ?
      `);
      const originalA = snapshots.get('request-a-first');
      const latestA = snapshots.get('request-a-return');
      assert.equal(originalA.id, firstA.handoverId);
      assert.equal(latestA.id, returnedA.handoverId);
      const originalPayload = JSON.parse(originalA.payloadJson);
      const latestPayload = JSON.parse(latestA.payloadJson);
      assert.equal(originalPayload.records.some((record) => record.id === 'project-a-record-2'), false);
      assert.equal(latestPayload.records.some((record) => record.id === 'project-a-record-2'), true);
      assert.equal(
        inspect.prepare('SELECT COUNT(*) AS count FROM handover_snapshots WHERE activation_request_id = ?')
          .get('request-a-first').count,
        1,
      );
    } finally {
      inspect.close();
    }

    const checkpoints = lifecycle.listCheckpoints('session-return');
    assert.deepEqual(checkpoints.map((item) => item.projectId), ['project-a', 'project-b']);
    assert.equal(checkpoints[0].outgoingActivationId, firstA.activation.id);
    assert.equal(checkpoints[1].outgoingActivationId, activatedB.activation.id);
    assert.equal(lifecycle.listDeliveryAttempts('session-return').length, 3);
    assert.ok(lifecycle.listDeliveryAttempts('session-return')
      .every((attempt) => attempt.outcome === 'acknowledged'));
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('SLA-05: failed switch preserves the checkpoint and recovery creates a fresh activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-failed-switch-recovery-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({
    outcomes: ['acknowledged', 'failed', 'acknowledged'],
  });

  const confirm = async (requestId, projectId) => lifecycle.confirmProjectActivation({
    requestId,
    confirmationToken: authority.issue({
      requestId, sessionId: 'session-failed-switch', projectId,
    }),
  });
  const activate = (requestId) => lifecycle.activateProject({
    requestId, providerAdapter: provider,
  });

  try {
    store.createProject({ id: 'project-failed-a', name: 'Project A' });
    store.createProject({ id: 'project-failed-b', name: 'Project B' });
    store.appendRecord({
      id: 'failed-a-record-1', projectId: 'project-failed-a',
      category: 'requirement', content: 'Original A context.',
      originType: 'user',
    });
    store.appendRecord({
      id: 'failed-b-record-1', projectId: 'project-failed-b',
      category: 'requirement', content: 'B context.',
      originType: 'user',
    });
    lifecycle.createSession({
      id: 'session-failed-switch', providerName: 'simulated-provider',
    });

    lifecycle.requestProjectActivation({
      sessionId: 'session-failed-switch',
      projectId: 'project-failed-a',
      requestId: 'request-failed-a-first',
    });
    await confirm('request-failed-a-first', 'project-failed-a');
    const firstA = await activate('request-failed-a-first');
    assert.equal(firstA.status, 'active');

    store.appendRecord({
      id: 'failed-a-record-2', projectId: 'project-failed-a',
      category: 'decision', content: 'A history recorded before checkpoint.',
      originType: 'user',
    });
    const aBoundaryBeforeSwitch = store.getProjectHistoryBoundary('project-failed-a');

    lifecycle.requestProjectActivation({
      sessionId: 'session-failed-switch',
      projectId: 'project-failed-b',
      requestId: 'request-failed-b',
    });
    await confirm('request-failed-b', 'project-failed-b');
    const checkpoint = lifecycle.checkpointActiveActivation({
      requestId: 'request-failed-b',
    });
    assert.equal(checkpoint.outgoingActivationId, firstA.activation.id);
    assert.equal(checkpoint.projectEventSequence, aBoundaryBeforeSwitch.eventSequence);
    assert.equal(checkpoint.projectRecordCount, 2);
    assert.equal(lifecycle.getActiveActivation('session-failed-switch'), null);

    const failedB = await activate('request-failed-b');
    assert.equal(failedB.status, 'blocked');
    assert.equal(failedB.reason, 'failed');
    assert.equal(failedB.activation, null);
    assert.equal(lifecycle.getActiveActivation('session-failed-switch'), null);
    assert.deepEqual(
      lifecycle.listActivations('session-failed-switch').map((item) => item.projectId),
      ['project-failed-a'],
    );
    assert.deepEqual(
      lifecycle.listDeliveryAttempts('session-failed-switch').map((item) => item.outcome),
      ['acknowledged', 'failed'],
    );
    assert.deepEqual(lifecycle.listCheckpoints('session-failed-switch'), [checkpoint]);

    const eventsAfterFailure = lifecycle.listEvents('session-failed-switch');
    assert.ok(eventsAfterFailure.some((event) =>
      event.eventType === 'activation_ended'
      && event.activationId === firstA.activation.id
      && event.checkpointId === checkpoint.id));
    assert.ok(eventsAfterFailure.some((event) =>
      event.eventType === 'delivery_failed'
      && event.activationRequestId === 'request-failed-b'));
    assert.equal(eventsAfterFailure.some((event) =>
      event.eventType === 'project_activated'
      && event.activationRequestId === 'request-failed-b'), false);

    // Recovery is a new, explicitly confirmed activation of A, not a rollback
    // of the ended A activation and not a retry of the failed B delivery.
    lifecycle.requestProjectActivation({
      sessionId: 'session-failed-switch',
      projectId: 'project-failed-a',
      requestId: 'request-failed-a-recovery',
    });
    await confirm('request-failed-a-recovery', 'project-failed-a');
    const recoveredA = await activate('request-failed-a-recovery');
    assert.equal(recoveredA.status, 'active');
    assert.notEqual(recoveredA.activation.id, firstA.activation.id);
    assert.notEqual(recoveredA.handoverId, firstA.handoverId);
    assert.equal(lifecycle.getActiveActivation('session-failed-switch').id,
      recoveredA.activation.id);
    assert.equal(lifecycle.getActiveActivation('session-failed-switch').projectId,
      'project-failed-a');

    const activations = lifecycle.listActivations('session-failed-switch');
    assert.deepEqual(activations.map((item) => item.projectId), [
      'project-failed-a', 'project-failed-a',
    ]);
    assert.notEqual(activations[0].id, activations[1].id);
    assert.notEqual(activations[0].handoverSnapshotId, activations[1].handoverSnapshotId);

    const attempts = lifecycle.listDeliveryAttempts('session-failed-switch');
    assert.deepEqual(attempts.map((item) => item.outcome), [
      'acknowledged', 'failed', 'acknowledged',
    ]);
    assert.notEqual(attempts[1].deliveryId, attempts[2].deliveryId);
    assert.equal(attempts[1].activationRequestId, 'request-failed-b');
    assert.equal(attempts[2].activationRequestId, 'request-failed-a-recovery');
    assert.deepEqual(lifecycle.listCheckpoints('session-failed-switch'), [checkpoint]);

    const inspect = new DatabaseSync(databasePath);
    try {
      const snapshots = inspect.prepare(`
        SELECT id, payload_json AS payloadJson
        FROM handover_snapshots
        WHERE activation_request_id = ?
      `);
      const originalA = snapshots.get('request-failed-a-first');
      const recoveryA = snapshots.get('request-failed-a-recovery');
      assert.equal(originalA.id, firstA.handoverId);
      assert.equal(recoveryA.id, recoveredA.handoverId);
      assert.equal(
        JSON.parse(originalA.payloadJson).records
          .some((record) => record.id === 'failed-a-record-2'),
        false,
      );
      assert.equal(
        JSON.parse(recoveryA.payloadJson).records
          .some((record) => record.id === 'failed-a-record-2'),
        true,
      );
      assert.equal(
        inspect.prepare('SELECT COUNT(*) AS count FROM handover_snapshots WHERE activation_request_id = ?')
          .get('request-failed-a-first').count,
        1,
      );
      assert.equal(
        inspect.prepare('SELECT COUNT(*) AS count FROM project_activations WHERE project_id = ?')
          .get('project-failed-b').count,
        0,
      );
      assert.throws(
        () => inspect.prepare(
          "UPDATE context_delivery_attempts SET outcome = 'acknowledged' WHERE activation_request_id = ?",
        ).run('request-failed-b'),
        /append-only/,
      );
    } finally {
      inspect.close();
    }

    assert.deepEqual(lifecycle.listCheckpoints('session-failed-switch'), [checkpoint]);
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
// SLA-06 through SLA-12 have dedicated executable acceptance tests in
// contribution-attribution, staleness-detection, concurrent-contributions,
// semantic-neutrality, cross-project-reference and session-ending test files.

test('lifecycle refuses to open without a trusted confirmation authority', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-no-authority-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  try {
    assert.throws(
      () => openSessionLifecycle(databasePath, store),
      /trusted confirmationAuthority/,
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLA-01: initial activation requires project confirmation and acknowledged delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-session-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });

  try {
    store.createProject({ id: 'project-a', name: 'Project A' });
    store.appendRecord({
      id: 'project-a-record-1',
      projectId: 'project-a',
      category: 'requirement',
      content: 'Preserve project continuity across AI sessions.',
      originType: 'user',
    });
    lifecycle.createSession({ id: 'session-1', providerName: 'simulated-provider' });
    lifecycle.createSession({ id: 'session-unconfirmed' });
    const provider = createSimulatedProvider({ outcomes: ['acknowledged'] });

    lifecycle.requestProjectActivation({
      sessionId: 'session-unconfirmed',
      projectId: 'project-a',
      requestId: 'request-unconfirmed',
    });

    await assert.rejects(
      lifecycle.activateProject({ requestId: 'request-unconfirmed', providerAdapter: provider }),
      /requires trusted user confirmation/,
    );
    assert.equal(lifecycle.getActiveActivation('session-unconfirmed'), null);
    assert.equal(lifecycle.listDeliveryAttempts('session-unconfirmed').length, 0);

    lifecycle.requestProjectActivation({
      sessionId: 'session-1',
      projectId: 'project-a',
      requestId: 'request-confirmed',
    });
    const confirmationToken = authority.issue({
      requestId: 'request-confirmed',
      sessionId: 'session-1',
      projectId: 'project-a',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-confirmed',
      confirmationToken,
    });
    const activated = await lifecycle.activateProject({
      requestId: 'request-confirmed',
      providerAdapter: provider,
    });

    assert.equal(activated.status, 'active');
    assert.equal(activated.activation.projectId, 'project-a');
    assert.equal(lifecycle.getActiveActivation('session-1').id, activated.activation.id);
    assert.equal(lifecycle.listActivations('session-1').length, 1);

    const attempts = lifecycle.listDeliveryAttempts('session-1');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].outcome, 'acknowledged');
    assert.equal(attempts[0].acknowledgementLevel, 'payload_accepted');
    assert.equal(attempts[0].handoverSnapshotId, activated.handoverId);

    const events = lifecycle.listEvents('session-1');
    assert.deepEqual(events.map((event) => event.eventType), [
      'session_created',
      'activation_requested',
      'project_confirmed',
      'handover_prepared',
      'delivery_intent_persisted',
      'delivery_acknowledged',
      'project_activated',
    ]);
    assert.equal(events.at(-1).activationId, activated.activation.id);

    const inspect = new DatabaseSync(databasePath);
    try {
      const confirmation = inspect.prepare(
        'SELECT project_id AS projectId, actor_id AS actorId, confirmation_method AS method FROM activation_confirmations WHERE activation_request_id = ?',
      ).get('request-confirmed');
      assert.deepEqual({ ...confirmation }, {
        projectId: 'project-a',
        actorId: 'test-user',
        method: 'simulated_test_confirmation',
      });
    } finally {
      inspect.close();
    }

    assert.throws(
      () => lifecycle.requestProjectActivation({
        sessionId: 'session-1',
        projectId: 'project-a',
        requestId: 'request-duplicate',
      }),
      /Project is already the active Project Activation/,
    );
    assert.equal(lifecycle.listActivations('session-1').length, 1);
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('confirmation tokens are trusted, exact, single-use and cannot be forged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-confirmation-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });

  try {
    store.createProject({ id: 'project-confirm', name: 'Confirmation project' });
    store.createProject({ id: 'project-other', name: 'Other project' });
    lifecycle.createSession({ id: 'session-confirm' });
    lifecycle.requestProjectActivation({
      sessionId: 'session-confirm',
      projectId: 'project-confirm',
      requestId: 'request-confirm',
    });

    await assert.rejects(
      lifecycle.confirmProjectActivation({
        requestId: 'request-confirm',
        confirmationToken: 'forged-token',
      }),
      /Unknown, forged or already-consumed/,
    );

    const mismatched = authority.issue({
      requestId: 'request-confirm',
      sessionId: 'session-confirm',
      projectId: 'project-other',
    });
    await assert.rejects(
      lifecycle.confirmProjectActivation({
        requestId: 'request-confirm',
        confirmationToken: mismatched,
      }),
      /scope does not match/,
    );

    const valid = authority.issue({
      requestId: 'request-confirm',
      sessionId: 'session-confirm',
      projectId: 'project-confirm',
      actorId: 'authenticated-test-actor',
    });
    const confirmed = await lifecycle.confirmProjectActivation({
      requestId: 'request-confirm',
      confirmationToken: valid,
    });
    assert.equal(confirmed.actorId, 'authenticated-test-actor');

    await assert.rejects(
      lifecycle.confirmProjectActivation({
        requestId: 'request-confirm',
        confirmationToken: valid,
      }),
      /not found or already confirmed/,
    );

    const provider = createSimulatedProvider();
    const activated = await lifecycle.activateProject({
      requestId: 'request-confirm',
      providerAdapter: provider,
    });
    assert.equal(activated.status, 'active');
    assert.equal(lifecycle.listActivations('session-confirm').length, 1);

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => inspect.prepare(
          "UPDATE activation_confirmations SET actor_id = 'forged' WHERE activation_request_id = ?",
        ).run('request-confirm'),
        /append-only/,
      );
      assert.throws(
        () => inspect.prepare(
          'DELETE FROM activation_confirmations WHERE activation_request_id = ?',
        ).run('request-confirm'),
        /append-only/,
      );
    } finally {
      inspect.close();
    }
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLT-21: provider acceptance followed by process death is never automatically replayed', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-delivery-recovery-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const markerPath = join(directory, 'provider-accepted.json');
  const workerPath = fileURLToPath(new URL('../test-support/delivery-crash-worker.mjs', import.meta.url));
  const authority = createSimulatedConfirmationAuthority();
  let store = openStore(databasePath);
  let lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  let reopened;

  try {
    store.createProject({ id: 'project-recovery', name: 'Recovery project' });
    lifecycle.createSession({ id: 'session-recovery' });
    lifecycle.requestProjectActivation({
      sessionId: 'session-recovery',
      projectId: 'project-recovery',
      requestId: 'request-recovery',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-recovery',
      confirmationToken: authority.issue({
        requestId: 'request-recovery',
        sessionId: 'session-recovery',
        projectId: 'project-recovery',
      }),
    });

    // Close the parent handles, then let a child process persist the intent,
    // simulate provider acceptance, and terminate before recording the response.
    lifecycle.close();
    store.close();
    store = null;
    const child = spawnSync(process.execPath, [
      workerPath, databasePath, 'request-recovery', markerPath,
    ], { encoding: 'utf8' });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 73);

    const providerReceipt = JSON.parse(readFileSync(markerPath, 'utf8'));
    assert.equal(providerReceipt.providerAccepted, true);
    assert.equal(typeof providerReceipt.deliveryId, 'string');

    store = openStore(databasePath);
    reopened = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
    const attempts = reopened.listDeliveryAttempts('session-recovery');
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].deliveryId, providerReceipt.deliveryId);
    assert.equal(attempts[0].outcome, 'unknown');
    assert.equal(attempts[0].unresolved, 1);
    assert.equal(attempts[0].id, null);
    assert.equal(attempts[0].attemptedAt, null);
    assert.equal(typeof attempts[0].intentCreatedAt, 'string');

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => inspect.prepare(
          "UPDATE context_delivery_intents SET created_at = 'changed' WHERE id = ?",
        ).run(providerReceipt.deliveryId),
        /append-only/,
      );
      assert.throws(
        () => inspect.prepare(
          'DELETE FROM context_delivery_intents WHERE id = ?',
        ).run(providerReceipt.deliveryId),
        /append-only/,
      );
    } finally {
      inspect.close();
    }

    await assert.rejects(
      reopened.activateProject({
        requestId: 'request-recovery',
        providerAdapter: {
          capabilities: { contextDelivery: true, acknowledgementLevel: 'payload_accepted' },
          async deliver() { throw new Error('Provider must not be called again'); },
        },
      }),
      /Delivery intent already exists; automatic retry is prohibited/,
    );

    assert.throws(
      () => reopened.requestProjectActivation({
        sessionId: 'session-recovery',
        projectId: 'project-recovery',
        requestId: 'request-recovery-again',
      }),
      /unresolved activation request/,
    );
    assert.equal(reopened.listDeliveryAttempts('session-recovery')[0].deliveryId, providerReceipt.deliveryId);
    assert.equal(reopened.getActiveActivation('session-recovery'), null);

    // Recovery is a separately authorised activation in a fresh DevBridge Session.
    reopened.createSession({ id: 'session-recovery-fresh' });
    reopened.requestProjectActivation({
      sessionId: 'session-recovery-fresh',
      projectId: 'project-recovery',
      requestId: 'request-recovery-fresh',
    });
    await reopened.confirmProjectActivation({
      requestId: 'request-recovery-fresh',
      confirmationToken: authority.issue({
        requestId: 'request-recovery-fresh',
        sessionId: 'session-recovery-fresh',
        projectId: 'project-recovery',
      }),
    });
    const freshActivation = await reopened.activateProject({
      requestId: 'request-recovery-fresh',
      providerAdapter: createSimulatedProvider(),
    });
    assert.equal(freshActivation.status, 'active');
    const originalUnknown = reopened.listDeliveryAttempts('session-recovery')[0];
    const freshDelivery = reopened.listDeliveryAttempts('session-recovery-fresh')[0];
    assert.equal(originalUnknown.outcome, 'unknown');
    assert.equal(originalUnknown.deliveryId, providerReceipt.deliveryId);
    assert.notEqual(freshDelivery.deliveryId, originalUnknown.deliveryId);
    assert.equal(reopened.getActiveActivation('session-recovery-fresh').projectId, 'project-recovery');
  } finally {
    lifecycle.close();
    reopened?.close();
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});



test('store v2 migration assigns stable per-Project sequences and adds activation attribution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-store-v3-migration-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const legacy = new DatabaseSync(databasePath);

  try {
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE project_records (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id)
      ) STRICT;
      CREATE TABLE project_events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        occurred_at TEXT NOT NULL
      ) STRICT;
      CREATE TRIGGER project_events_no_update
      BEFORE UPDATE ON project_events
      BEGIN SELECT RAISE(ABORT, 'project events are append-only'); END;
      CREATE TRIGGER project_events_no_delete
      BEFORE DELETE ON project_events
      BEGIN SELECT RAISE(ABORT, 'project events are append-only'); END;
      INSERT INTO projects (id) VALUES ('legacy-project');
      INSERT INTO project_events (id, project_id, occurred_at)
        VALUES ('z-first-inserted', 'legacy-project', '2026-01-01T00:00:00.000Z');
      INSERT INTO project_events (id, project_id, occurred_at)
        VALUES ('a-second-inserted', 'legacy-project', '2026-01-01T00:00:00.000Z');
      PRAGMA user_version = 2;
    `);
  } finally {
    legacy.close();
  }

  const store = openStore(databasePath);
  try {
    const boundary = store.getProjectHistoryBoundary('legacy-project');
    assert.equal(boundary.eventSequence, 2);
    assert.equal(boundary.eventCount, 2);
    assert.equal(boundary.recordCount, 0);
    assert.equal(boundary.lastEventId, 'a-second-inserted');

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.deepEqual(
        inspect.prepare('SELECT id, event_sequence AS sequence FROM project_events ORDER BY event_sequence')
          .all().map((row) => ({ ...row })),
        [
          { id: 'z-first-inserted', sequence: 1 },
          { id: 'a-second-inserted', sequence: 2 },
        ],
      );
      assert.equal(inspect.prepare('PRAGMA user_version').get().user_version, 7);
      const recordColumns = inspect.prepare('PRAGMA table_info(project_records)').all()
        .map((column) => column.name);
      assert.ok(recordColumns.includes('session_id'));
      assert.ok(recordColumns.includes('activation_id'));
      assert.ok(recordColumns.includes('handover_snapshot_id'));
    } finally {
      inspect.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLT-23: outgoing checkpoint captures a durable Project history boundary and ends only its activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-checkpoint-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });

  try {
    store.createProject({ id: 'project-checkpoint-a', name: 'Checkpoint A' });
    store.createProject({ id: 'project-checkpoint-b', name: 'Checkpoint B' });
    store.appendRecord({
      id: 'checkpoint-a-record-1',
      projectId: 'project-checkpoint-a',
      category: 'requirement',
      content: 'Initial A requirement',
      originType: 'user',
    });
    lifecycle.createSession({ id: 'session-checkpoint' });
    lifecycle.requestProjectActivation({
      sessionId: 'session-checkpoint',
      projectId: 'project-checkpoint-a',
      requestId: 'request-checkpoint-a',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-checkpoint-a',
      confirmationToken: authority.issue({
        requestId: 'request-checkpoint-a',
        sessionId: 'session-checkpoint',
        projectId: 'project-checkpoint-a',
      }),
    });
    const first = await lifecycle.activateProject({
      requestId: 'request-checkpoint-a',
      providerAdapter: createSimulatedProvider(),
    });
    assert.equal(first.status, 'active');

    store.appendRecord({
      id: 'checkpoint-a-record-2',
      projectId: 'project-checkpoint-a',
      category: 'change',
      content: 'A contribution recorded before switching',
      originType: 'ai',
    });
    const boundaryBeforeCheckpoint = store.getProjectHistoryBoundary('project-checkpoint-a');

    lifecycle.requestProjectActivation({
      sessionId: 'session-checkpoint',
      projectId: 'project-checkpoint-b',
      requestId: 'request-checkpoint-b',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-checkpoint-b',
      confirmationToken: authority.issue({
        requestId: 'request-checkpoint-b',
        sessionId: 'session-checkpoint',
        projectId: 'project-checkpoint-b',
      }),
    });

    await assert.rejects(
      lifecycle.activateProject({
        requestId: 'request-checkpoint-b',
        providerAdapter: createSimulatedProvider(),
      }),
      /Outgoing Project Activation must be checkpointed/,
    );
    assert.equal(lifecycle.listDeliveryAttempts('session-checkpoint').length, 1);

    const priorLifecycleSequence = lifecycle.listEvents('session-checkpoint').at(-1).sequence;
    const checkpoint = lifecycle.checkpointActiveActivation({
      requestId: 'request-checkpoint-b',
    });
    assert.equal(checkpoint.sessionId, 'session-checkpoint');
    assert.equal(checkpoint.projectId, 'project-checkpoint-a');
    assert.equal(checkpoint.outgoingActivationId, first.activation.id);
    assert.equal(checkpoint.incomingActivationRequestId, 'request-checkpoint-b');
    assert.equal(checkpoint.handoverSnapshotId, first.handoverId);
    assert.equal(checkpoint.projectEventSequence, boundaryBeforeCheckpoint.eventSequence);
    assert.equal(checkpoint.projectEventId, boundaryBeforeCheckpoint.lastEventId);
    assert.equal(checkpoint.projectRecordCount, 2);
    assert.equal(checkpoint.projectEventCount, boundaryBeforeCheckpoint.eventCount);
    assert.equal(checkpoint.lifecycleEventSequence, priorLifecycleSequence);
    assert.equal(lifecycle.getActiveActivation('session-checkpoint'), null);

    const checkpointEvents = lifecycle.listEvents('session-checkpoint').slice(-2);
    assert.deepEqual(checkpointEvents.map((event) => event.eventType), [
      'activation_checkpointed',
      'activation_ended',
    ]);
    assert.ok(checkpointEvents.every((event) => event.checkpointId === checkpoint.id));
    assert.equal(checkpointEvents.at(-1).activationId, first.activation.id);

    store.appendRecord({
      id: 'checkpoint-a-record-after',
      projectId: 'project-checkpoint-a',
      category: 'status',
      content: 'A later contribution after the checkpoint',
      originType: 'user',
    });
    const laterBoundary = store.getProjectHistoryBoundary('project-checkpoint-a');
    assert.equal(laterBoundary.eventSequence, checkpoint.projectEventSequence + 1);
    assert.equal(lifecycle.listCheckpoints('session-checkpoint')[0].projectEventSequence,
      checkpoint.projectEventSequence);

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => inspect.prepare(
          "UPDATE outgoing_checkpoints SET checkpointed_at = 'changed' WHERE id = ?",
        ).run(checkpoint.id),
        /append-only/,
      );
      assert.throws(
        () => inspect.prepare(
          'DELETE FROM outgoing_checkpoints WHERE id = ?',
        ).run(checkpoint.id),
        /append-only/,
      );
    } finally {
      inspect.close();
    }

    const switched = await lifecycle.activateProject({
      requestId: 'request-checkpoint-b',
      providerAdapter: createSimulatedProvider(),
    });
    assert.equal(switched.status, 'active');
    assert.equal(lifecycle.getActiveActivation('session-checkpoint').projectId, 'project-checkpoint-b');
    assert.equal(lifecycle.listActivations('session-checkpoint').length, 2);
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('overlapping activation requests are serialized across lifecycle handles', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-session-overlap-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  let releaseDelivery;
  let deliveryStarted;
  const started = new Promise((resolve) => { deliveryStarted = resolve; });
  let deliveryCalls = 0;
  const provider = {
    capabilities: {
      contextDelivery: true,
      acknowledgementLevel: 'payload_accepted',
      provesModelComprehension: false,
    },
    async deliver({ deliveryId, idempotencyKey, handover, activationRequestId }) {
      assert.equal(idempotencyKey, deliveryId);
      deliveryCalls += 1;
      deliveryStarted();
      await new Promise((resolve) => { releaseDelivery = resolve; });
      return {
        deliveryId,
        activationRequestId,
        handoverId: handover.id,
        attemptId: 'provider-attempt-1',
        outcome: 'acknowledged',
        acknowledgementLevel: 'payload_accepted',
      };
    },
  };

  try {
    store.createProject({ id: 'project-overlap', name: 'Overlap project' });
    firstLifecycle.createSession({ id: 'session-overlap' });

    firstLifecycle.requestProjectActivation({
      sessionId: 'session-overlap',
      projectId: 'project-overlap',
      requestId: 'request-overlap-1',
    });
    const overlapToken = authority.issue({
      requestId: 'request-overlap-1',
      sessionId: 'session-overlap',
      projectId: 'project-overlap',
    });
    await firstLifecycle.confirmProjectActivation({
      requestId: 'request-overlap-1',
      confirmationToken: overlapToken,
    });
    const firstActivation = firstLifecycle.activateProject({
      requestId: 'request-overlap-1',
      providerAdapter: provider,
    });
    await started;

    await assert.rejects(
      secondLifecycle.activateProject({
        requestId: 'request-overlap-1',
        providerAdapter: provider,
      }),
      /Delivery intent already exists; automatic retry is prohibited/,
    );

    assert.throws(
      () => secondLifecycle.requestProjectActivation({
        sessionId: 'session-overlap',
        projectId: 'project-overlap',
        requestId: 'request-overlap-2',
      }),
      /unresolved activation request/,
    );

    assert.equal(deliveryCalls, 1);
    releaseDelivery();
    const result = await firstActivation;
    assert.equal(result.status, 'active');
    assert.equal(firstLifecycle.listActivations('session-overlap').length, 1);
    assert.equal(firstLifecycle.listEvents('session-overlap')
      .filter((event) => event.eventType === 'activation_requested').length, 1);
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLT-14: mismatched provider acknowledgement remains unresolved and blocks continuation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-ack-mismatch-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = {
    capabilities: {
      contextDelivery: true,
      acknowledgementLevel: 'payload_accepted',
    },
    async deliver({ deliveryId, handover, activationRequestId }) {
      return {
        deliveryId,
        handoverId: handover.id,
        activationRequestId,
        attemptId: 'mismatched-provider-attempt',
        outcome: 'acknowledged',
        acknowledgementLevel: 'model_comprehension',
      };
    },
  };

  try {
    store.createProject({ id: 'project-mismatch', name: 'Mismatch project' });
    lifecycle.createSession({ id: 'session-mismatch' });
    lifecycle.requestProjectActivation({
      sessionId: 'session-mismatch',
      projectId: 'project-mismatch',
      requestId: 'request-mismatch',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-mismatch',
      confirmationToken: authority.issue({
        requestId: 'request-mismatch',
        sessionId: 'session-mismatch',
        projectId: 'project-mismatch',
      }),
    });

    const result = await lifecycle.activateProject({
      requestId: 'request-mismatch',
      providerAdapter: provider,
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'unknown');
    assert.equal(lifecycle.getActiveActivation('session-mismatch'), null);
    assert.equal(lifecycle.listDeliveryAttempts('session-mismatch')[0].outcome, 'unknown');
    assert.equal(lifecycle.listDeliveryAttempts('session-mismatch')[0].unresolved, 1);
    assert.throws(
      () => lifecycle.requestProjectActivation({
        sessionId: 'session-mismatch',
        projectId: 'project-mismatch',
        requestId: 'request-after-mismatch',
      }),
      /unresolved activation request/,
    );
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SLA-04: failed or unknown delivery blocks activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-session-failure-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });

  try {
    store.createProject({ id: 'project-f', name: 'Failure project' });
    lifecycle.createSession({ id: 'session-f' });
    const provider = createSimulatedProvider({ outcomes: ['failed', 'unknown'] });

    lifecycle.requestProjectActivation({
      sessionId: 'session-f', projectId: 'project-f', requestId: 'request-failed',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-failed',
      confirmationToken: authority.issue({
        requestId: 'request-failed', sessionId: 'session-f', projectId: 'project-f',
      }),
    });
    const failed = await lifecycle.activateProject({
      requestId: 'request-failed', providerAdapter: provider,
    });

    lifecycle.requestProjectActivation({
      sessionId: 'session-f', projectId: 'project-f', requestId: 'request-unknown',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'request-unknown',
      confirmationToken: authority.issue({
        requestId: 'request-unknown', sessionId: 'session-f', projectId: 'project-f',
      }),
    });
    const unknown = await lifecycle.activateProject({
      requestId: 'request-unknown', providerAdapter: provider,
    });

    assert.equal(failed.status, 'blocked');
    assert.equal(failed.reason, 'failed');
    assert.equal(unknown.status, 'blocked');
    assert.equal(unknown.reason, 'unknown');
    assert.equal(lifecycle.getActiveActivation('session-f'), null);
    assert.equal(lifecycle.listActivations('session-f').length, 0);
    assert.deepEqual(
      lifecycle.listDeliveryAttempts('session-f').map((attempt) => attempt.outcome),
      ['failed', 'unknown'],
    );
    assert.equal(lifecycle.listDeliveryAttempts('session-f')[1].unresolved, 1);
    assert.throws(
      () => lifecycle.requestProjectActivation({
        sessionId: 'session-f', projectId: 'project-f', requestId: 'request-after-unknown',
      }),
      /unresolved activation request/,
    );
    assert.equal(
      lifecycle.listEvents('session-f').filter((event) => event.eventType === 'project_activated').length,
      0,
    );
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
