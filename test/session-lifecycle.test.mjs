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

// Scenarios not yet implemented remain explicit TODOs. The lifecycle API below
// exercises only the initial activation and confirmation boundary.
test.todo('SLA-02: switching A to B checkpoints A and activates B only after delivery');
test.todo('SLA-03: returning B to A creates a fresh A activation and handover');
test.todo('SLA-05: failed transition preserves the outgoing checkpoint and all history');
test.todo('SLA-06: contributions use the active Project Activation');
test.todo('SLA-07: a newer contribution marks another active activation potentially stale');
test.todo('SLA-08: a stale activation refreshes before its next continuation');
test.todo('SLA-09: concurrent contributions remain distinct and attributable');
test.todo('SLA-10: concurrency and staleness do not become semantic conflict judgements');
test.todo('SLA-11: cross-Project reference does not activate or disclose another Project');
test.todo('SLA-12: ending a Session leaves Project identity and history intact');

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

    await assert.rejects(
      lifecycle.requestProjectActivation({
        sessionId: 'session-1',
        projectId: 'project-a',
        requestId: 'request-duplicate',
      }),
      /already has an active Project Activation/,
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

    await assert.rejects(
      secondLifecycle.requestProjectActivation({
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
