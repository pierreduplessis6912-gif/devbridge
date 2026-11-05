import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';

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
    handover,
    activationRequestId: 'activation-request-1',
  });
  const failed = await provider.deliver({
    handover,
    activationRequestId: 'activation-request-2',
  });
  const unknown = await provider.deliver({
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
  assert.equal(acknowledged.activationRequestId, 'activation-request-1');
  assert.equal(acknowledged.provesModelComprehension, false);
});

test('simulated provider preserves distinct retry attempts and rejects an exhausted outcome script', async () => {
  const provider = createSimulatedProvider({
    outcomes: ['failed', 'acknowledged'],
  });
  const handover = { id: 'handover-b-1', projectId: 'project-b' };

  const first = await provider.deliver({
    handover,
    activationRequestId: 'activation-request-b',
  });
  const retry = await provider.deliver({
    handover,
    activationRequestId: 'activation-request-b',
  });

  assert.equal(first.outcome, 'failed');
  assert.equal(retry.outcome, 'acknowledged');
  assert.notEqual(first.attemptId, retry.attemptId);
  assert.equal(first.sequence, 1);
  assert.equal(retry.sequence, 2);

  await assert.rejects(
    provider.deliver({
      handover,
      activationRequestId: 'activation-request-b',
    }),
    /No simulated outcome remains/,
  );
});

test('simulated provider rejects malformed delivery requests', async () => {
  const provider = createSimulatedProvider();

  await assert.rejects(
    provider.deliver({ activationRequestId: 'activation-request-1' }),
    /handover with a non-empty id is required/,
  );
  await assert.rejects(
    provider.deliver({ handover: { id: 'handover-a' } }),
    /activationRequestId is required/,
  );
});

// These contract scenarios become executable as the lifecycle coordinator
// and persistence model are introduced. TODO is intentional: the current
// continuity store has no Session or Project Activation API yet.
test.todo('SLA-02: switching A to B checkpoints A and activates B only after delivery');
test.todo('SLA-03: returning B to A creates a fresh A activation and handover');
test.todo('SLA-04: failed or unknown delivery blocks the incoming activation');
test.todo('SLA-05: failed transition preserves the outgoing checkpoint and all history');
test.todo('SLA-06: contributions use the active Project Activation');
test.todo('SLA-07: a newer contribution marks another active activation potentially stale');
test.todo('SLA-08: a stale activation refreshes before its next continuation');
test.todo('SLA-09: concurrent contributions remain distinct and attributable');
test.todo('SLA-10: concurrency and staleness do not become semantic conflict judgements');
test.todo('SLA-11: cross-Project reference does not activate or disclose another Project');
test.todo('SLA-12: ending a Session leaves Project identity and history intact');

test('SLA-01: initial activation requires project confirmation and acknowledged delivery', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-session-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const lifecycle = openSessionLifecycle(databasePath, store);

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
    const provider = createSimulatedProvider({ outcomes: ['acknowledged'] });

    const unconfirmed = await lifecycle.activateProject({
      sessionId: 'session-1',
      projectId: 'project-a',
      providerAdapter: provider,
      requestId: 'request-unconfirmed',
    });

    assert.equal(unconfirmed.status, 'blocked');
    assert.equal(unconfirmed.reason, 'project_not_confirmed');
    assert.equal(lifecycle.getActiveActivation('session-1'), null);
    assert.equal(lifecycle.listDeliveryAttempts('session-1').length, 0);

    const activated = await lifecycle.activateProject({
      sessionId: 'session-1',
      projectId: 'project-a',
      confirmedProjectId: 'project-a',
      providerAdapter: provider,
      requestId: 'request-confirmed',
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
      'project_confirmation_failed',
      'activation_requested',
      'project_confirmed',
      'handover_prepared',
      'delivery_acknowledged',
      'project_activated',
    ]);
    assert.equal(events.at(-1).activationId, activated.activation.id);

    const inspect = new DatabaseSync(databasePath);
    try {
      const confirmation = inspect.prepare(
        'SELECT confirmed_project_id AS projectId, confirmed_by AS confirmedBy, confirmation_method AS method FROM activation_requests WHERE id = ?',
      ).get('request-confirmed');
      assert.deepEqual(confirmation, {
        projectId: 'project-a',
        confirmedBy: 'user',
        method: 'explicit_project_id',
      });
    } finally {
      inspect.close();
    }

    await assert.rejects(
      lifecycle.activateProject({
        sessionId: 'session-1',
        projectId: 'project-a',
        confirmedProjectId: 'project-a',
        providerAdapter: provider,
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

test('failed or unknown initial delivery never creates an active Project Activation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-session-failure-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const lifecycle = openSessionLifecycle(databasePath, store);

  try {
    store.createProject({ id: 'project-f', name: 'Failure project' });
    lifecycle.createSession({ id: 'session-f' });
    const provider = createSimulatedProvider({ outcomes: ['failed', 'unknown'] });

    const failed = await lifecycle.activateProject({
      sessionId: 'session-f',
      projectId: 'project-f',
      confirmedProjectId: 'project-f',
      providerAdapter: provider,
      requestId: 'request-failed',
    });
    const unknown = await lifecycle.activateProject({
      sessionId: 'session-f',
      projectId: 'project-f',
      confirmedProjectId: 'project-f',
      providerAdapter: provider,
      requestId: 'request-unknown',
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
