import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';
import { createSimulatedConfirmationAuthority } from '../test-support/simulated-confirmation-authority.mjs';

function fixture(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  return {
    directory, databasePath, store, authority, lifecycle,
    close() {
      lifecycle.close();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

async function activate(f, sessionId, projectId, requestId) {
  f.lifecycle.requestProjectActivation({ sessionId, projectId, requestId });
  await f.lifecycle.confirmProjectActivation({
    requestId,
    confirmationToken: f.authority.issue({ requestId, sessionId, projectId }),
  });
  return f.lifecycle.activateProject({
    requestId,
    providerAdapter: createSimulatedProvider({ outcomes: ['acknowledged'] }),
  });
}

test('SLA-12: ending a Session preserves Project identity, records and activation history', async () => {
  const f = fixture('devbridge-session-end-');
  try {
    const project = f.store.createProject({
      id: 'session-end-project', name: 'Persistent Project', purpose: 'Must outlive Sessions',
    });
    f.store.appendRecord({
      id: 'session-end-seed', projectId: project.id, category: 'requirement',
      content: 'Original Project history remains available.', originType: 'user',
    });
    f.lifecycle.createSession({
      id: 'session-end-active', providerName: 'test-provider',
      modelName: 'test-model', externalConversationId: 'provider-chat-77',
    });
    const activated = await activate(
      f, 'session-end-active', project.id, 'session-end-request',
    );
    assert.equal(activated.status, 'active');

    const contribution = f.lifecycle.recordContribution({
      sessionId: 'session-end-active', category: 'decision',
      content: 'A contribution recorded during the Session.',
      originType: 'user', id: 'session-end-contribution',
    });
    const projectBefore = f.store.getProject(project.id);
    const seedRecordBefore = f.store.getRecord('session-end-seed');
    const boundaryBefore = f.store.getProjectHistoryBoundary(project.id);
    const recordBefore = f.store.getRecord(contribution.id);
    const activationBefore = f.lifecycle.listActivations('session-end-active');
    const end = f.lifecycle.endSession({
      sessionId: 'session-end-active', endedAt: '2026-11-06T12:00:00.000Z',
    });

    assert.equal(end.status, 'ended');
    assert.equal(end.session.status, 'ended');
    assert.equal(end.session.endedAt, '2026-11-06T12:00:00.000Z');
    assert.equal(end.session.providerName, 'test-provider');
    assert.equal(end.session.modelName, 'test-model');
    assert.equal(end.session.externalConversationId, 'provider-chat-77');
    assert.equal(f.lifecycle.getActiveActivation('session-end-active'), null);
    assert.deepEqual(f.lifecycle.listActivations('session-end-active'), activationBefore);
    assert.deepEqual(f.store.getProject(project.id), projectBefore);
    const boundaryAfter = f.store.getProjectHistoryBoundary(project.id);
    for (const key of ['projectId', 'recordCount', 'eventCount', 'eventSequence', 'lastEventId', 'lastEventAt']) {
      assert.equal(boundaryAfter[key], boundaryBefore[key], key);
    }
    assert.deepEqual(f.store.getRecord('session-end-seed'), seedRecordBefore);
    assert.deepEqual(f.store.getRecord(contribution.id), recordBefore);

    const events = f.lifecycle.listEvents('session-end-active');
    assert.equal(events.at(-2).eventType, 'activation_ended');
    assert.equal(events.at(-1).eventType, 'session_ended');
    assert.equal(events.at(-2).activationId, activated.activation.id);
    assert.equal(events.at(-1).activationId, activated.activation.id);

    const repeated = f.lifecycle.endSession({ sessionId: 'session-end-active' });
    assert.equal(repeated.status, 'already_ended');
    assert.equal(repeated.event.id, end.event.id);
    assert.equal(f.lifecycle.listEvents('session-end-active')
      .filter((event) => event.eventType === 'session_ended').length, 1);

    assert.throws(() => f.lifecycle.requestProjectActivation({
      sessionId: 'session-end-active', projectId: project.id,
    }), /Session has ended/);
    assert.throws(() => f.lifecycle.prepareContribution({
      sessionId: 'session-end-active', category: 'note',
      content: 'A new post-end contribution.', originType: 'user',
    }), /no active confirmed Project Activation/);
    await assert.rejects(
      f.lifecycle.refreshStaleActivation({
        sessionId: 'session-end-active',
        providerAdapter: createSimulatedProvider(),
      }),
      /Session has ended/,
    );

    const inspect = new DatabaseSync(f.databasePath);
    try {
      assert.throws(() => inspect.prepare(`
        INSERT INTO activation_requests (id,session_id,project_id,requested_at)
        VALUES ('direct-after-end','session-end-active','session-end-project','2026-11-06T12:01:00.000Z')
      `).run(), /Session has ended/);
      assert.throws(() => inspect.prepare(
        "UPDATE sessions SET provider_name='rewritten' WHERE id='session-end-active'",
      ).run(), /append-only/);
      assert.throws(() => inspect.prepare(
        "DELETE FROM session_lifecycle_events WHERE session_id='session-end-active'",
      ).run(), /append-only/);
    } finally {
      inspect.close();
    }
  } finally {
    f.close();
  }
});

test('SLA-12: a late provider acknowledgement after Session end cannot activate the Project', async () => {
  const f = fixture('devbridge-session-end-flight-');
  let signalStarted;
  let resolveDelivery;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const pending = new Promise((resolve) => { resolveDelivery = resolve; });
  const provider = {
    capabilities: {
      contextDelivery: true,
      acknowledgementLevel: 'payload_accepted',
      provesModelComprehension: false,
    },
    async deliver(input) {
      signalStarted(input);
      return pending;
    },
  };
  try {
    f.store.createProject({ id: 'late-project', name: 'Late delivery project' });
    f.lifecycle.createSession({ id: 'late-session' });
    f.lifecycle.requestProjectActivation({
      sessionId: 'late-session', projectId: 'late-project', requestId: 'late-request',
    });
    await f.lifecycle.confirmProjectActivation({
      requestId: 'late-request',
      confirmationToken: f.authority.issue({
        requestId: 'late-request', sessionId: 'late-session', projectId: 'late-project',
      }),
    });
    const activationWork = f.lifecycle.activateProject({
      requestId: 'late-request', providerAdapter: provider,
    });
    const deliveryInput = await started;
    assert.ok(deliveryInput.deliveryId);
    assert.equal(f.lifecycle.listDeliveryAttempts('late-session')[0].outcome, 'unknown');

    f.lifecycle.endSession({ sessionId: 'late-session' });
    resolveDelivery({
      deliveryId: deliveryInput.deliveryId,
      activationRequestId: 'late-request',
      handoverId: deliveryInput.handover.id,
      attemptId: 'late-provider-ack',
      providerReference: 'late-provider-reference',
      outcome: 'acknowledged',
      acknowledgementLevel: 'payload_accepted',
    });
    const result = await activationWork;

    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'session_ended');
    assert.equal(result.activation, null);
    assert.equal(f.lifecycle.getActiveActivation('late-session'), null);
    assert.equal(f.lifecycle.listActivations('late-session').length, 0);
    const attempt = f.lifecycle.listDeliveryAttempts('late-session')[0];
    assert.equal(attempt.outcome, 'acknowledged');
    assert.equal(attempt.deliveryId, deliveryInput.deliveryId);
    assert.equal(attempt.unresolved, 0);
    const eventTypes = f.lifecycle.listEvents('late-session').map((event) => event.eventType);
    assert.ok(eventTypes.indexOf('session_ended') < eventTypes.indexOf('delivery_acknowledged'));
    assert.equal(f.store.getProject('late-project').name, 'Late delivery project');
  } finally {
    f.close();
  }
});

test('SLA-12: an already-reserved contribution may finish, but no new submission can begin', async () => {
  const f = fixture('devbridge-session-end-reserved-');
  try {
    f.store.createProject({ id: 'reserved-project', name: 'Reserved work project' });
    f.lifecycle.createSession({ id: 'reserved-session' });
    const activated = await activate(
      f, 'reserved-session', 'reserved-project', 'reserved-request',
    );
    assert.equal(activated.status, 'active');

    const prepared = f.lifecycle.prepareContribution({
      sessionId: 'reserved-session', category: 'note',
      content: 'Submitted before the Session ended.',
      originType: 'user', id: 'reserved-record',
    });
    f.lifecycle.endSession({ sessionId: 'reserved-session' });

    const committed = f.lifecycle.commitContribution({ intentId: prepared.intentId });
    assert.equal(committed.id, 'reserved-record');
    assert.equal(committed.sessionId, 'reserved-session');
    assert.equal(committed.activationId, activated.activation.id);
    assert.equal(f.lifecycle.listContributionIntents('reserved-session')[0].status, 'committed');
    assert.throws(() => f.lifecycle.prepareContribution({
      sessionId: 'reserved-session', category: 'note',
      content: 'This was not submitted before ending.', originType: 'user',
    }), /no active confirmed Project Activation/);
  } finally {
    f.close();
  }
});
