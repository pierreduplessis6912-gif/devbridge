import assert from 'node:assert/strict';
import { test } from 'node:test';
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
test.todo('SLA-01: initial activation requires project confirmation and acknowledged delivery');
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
