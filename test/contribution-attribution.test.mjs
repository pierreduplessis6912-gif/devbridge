import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';
import { createSimulatedConfirmationAuthority } from '../test-support/simulated-confirmation-authority.mjs';

test('SLA-06: contributions retain the active Project Activation and handover attribution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-contribution-attribution-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });
  const provider = createSimulatedProvider({
    outcomes: ['acknowledged', 'acknowledged'],
  });

  const confirm = async (requestId, projectId) => lifecycle.confirmProjectActivation({
    requestId,
    confirmationToken: authority.issue({
      requestId, sessionId: 'session-attribution', projectId,
    }),
  });

  try {
    store.createProject({ id: 'attribution-project-a', name: 'Project A' });
    store.createProject({ id: 'attribution-project-b', name: 'Project B' });
    lifecycle.createSession({
      id: 'session-attribution',
      providerName: 'simulated-provider',
    });

    assert.throws(
      () => lifecycle.recordContribution({
        sessionId: 'session-attribution',
        category: 'user_contribution',
        content: 'Must not be guessed into a Project.',
        originType: 'user',
      }),
      /no active confirmed Project Activation/,
    );

    lifecycle.requestProjectActivation({
      sessionId: 'session-attribution',
      projectId: 'attribution-project-a',
      requestId: 'request-attribution-a',
    });
    await confirm('request-attribution-a', 'attribution-project-a');
    const activatedA = await lifecycle.activateProject({
      requestId: 'request-attribution-a',
      providerAdapter: provider,
    });
    assert.equal(activatedA.status, 'active');

    const contributionA = lifecycle.recordContribution({
      id: 'attribution-record-a',
      sessionId: 'session-attribution',
      category: 'user_contribution',
      content: 'A contribution made while Project A was active.',
      originType: 'user',
      originLabel: 'authenticated-user',
      sourceRef: 'user-entry-a',
      recordedAt: '2026-11-06T10:10:00.000Z',
    });

    assert.equal(contributionA.projectId, 'attribution-project-a');
    assert.equal(contributionA.sessionId, 'session-attribution');
    assert.equal(contributionA.activationId, activatedA.activation.id);
    assert.equal(contributionA.handoverSnapshotId, activatedA.handoverId);
    assert.equal(contributionA.originType, 'user');
    assert.equal(contributionA.originLabel, 'authenticated-user');
    assert.equal(contributionA.sourceRef, 'user-entry-a');

    lifecycle.requestProjectActivation({
      sessionId: 'session-attribution',
      projectId: 'attribution-project-b',
      requestId: 'request-attribution-b',
    });
    await confirm('request-attribution-b', 'attribution-project-b');
    lifecycle.checkpointActiveActivation({
      requestId: 'request-attribution-b',
    });

    assert.throws(
      () => lifecycle.recordContribution({
        sessionId: 'session-attribution',
        category: 'user_contribution',
        content: 'Must not continue under the ended A activation.',
        originType: 'user',
      }),
      /no active confirmed Project Activation/,
    );

    // The database also rejects a caller trying to reuse the ended activation's
    // attribution outside the lifecycle recording boundary.
    assert.throws(
      () => store.appendRecord({
        projectId: 'attribution-project-a',
        category: 'user_contribution',
        content: 'Must not be attached to an ended activation.',
        originType: 'user',
        sessionId: 'session-attribution',
        activationId: activatedA.activation.id,
        handoverSnapshotId: activatedA.handoverId,
      }),
      /active confirmed Project Activation/,
    );

    const activatedB = await lifecycle.activateProject({
      requestId: 'request-attribution-b',
      providerAdapter: provider,
    });
    assert.equal(activatedB.status, 'active');

    const contributionB = lifecycle.recordContribution({
      id: 'attribution-record-b',
      sessionId: 'session-attribution',
      category: 'ai_contribution',
      content: 'A contribution made after Project B became active.',
      originType: 'ai',
      originLabel: 'simulated-model',
      sourceRef: 'provider-message-b',
      recordedAt: '2026-11-06T10:12:00.000Z',
    });

    assert.equal(contributionB.projectId, 'attribution-project-b');
    assert.equal(contributionB.sessionId, 'session-attribution');
    assert.equal(contributionB.activationId, activatedB.activation.id);
    assert.equal(contributionB.handoverSnapshotId, activatedB.handoverId);
    assert.equal(contributionB.originType, 'ai');
    assert.equal(contributionB.originLabel, 'simulated-model');
    assert.equal(contributionB.sourceRef, 'provider-message-b');

    const preservedA = store.getRecord('attribution-record-a');
    assert.equal(preservedA.projectId, 'attribution-project-a');
    assert.equal(preservedA.activationId, activatedA.activation.id);
    assert.equal(preservedA.handoverSnapshotId, activatedA.handoverId);

    assert.deepEqual(
      store.listRecords('attribution-project-a').map((record) => record.id),
      ['attribution-record-a'],
    );
    assert.deepEqual(
      store.listRecords('attribution-project-b').map((record) => record.id),
      ['attribution-record-b'],
    );
  } finally {
    lifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
