import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';
import { openSessionLifecycle } from '../src/session-lifecycle.mjs';
import { openCrossProjectReferences } from '../src/cross-project-references.mjs';
import { createSimulatedProvider } from '../test-support/simulated-provider.mjs';
import { createSimulatedConfirmationAuthority } from '../test-support/simulated-confirmation-authority.mjs';

test('SLA-11: a Cross-Project reference does not activate or disclose the referenced Project', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-cross-project-reference-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const references = openCrossProjectReferences(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const lifecycle = openSessionLifecycle(databasePath, store, {
    confirmationAuthority: authority,
  });
  const simulatedProvider = createSimulatedProvider({ outcomes: ['acknowledged'] });
  const deliveredHandovers = [];
  const provider = Object.freeze({
    capabilities: simulatedProvider.capabilities,
    async deliver(payload) {
      deliveredHandovers.push(payload.handover);
      return simulatedProvider.deliver(payload);
    },
  });

  try {
    store.createProject({ id: 'cross-reference-project-a', name: 'Project A' });
    store.createProject({
      id: 'cross-reference-project-b',
      name: 'Project B',
      purpose: 'Private target-project purpose',
    });
    store.appendRecord({
      id: 'cross-reference-a-record',
      projectId: 'cross-reference-project-a',
      category: 'decision',
      content: 'Project A remains the active context.',
      originType: 'user',
    });
    store.appendRecord({
      id: 'cross-reference-b-private-record',
      projectId: 'cross-reference-project-b',
      category: 'decision',
      content: 'Private Project B record must not be disclosed.',
      originType: 'user',
    });

    lifecycle.createSession({ id: 'cross-reference-session' });
    lifecycle.requestProjectActivation({
      sessionId: 'cross-reference-session',
      projectId: 'cross-reference-project-a',
      requestId: 'cross-reference-activation-request',
    });
    await lifecycle.confirmProjectActivation({
      requestId: 'cross-reference-activation-request',
      confirmationToken: authority.issue({
        requestId: 'cross-reference-activation-request',
        sessionId: 'cross-reference-session',
        projectId: 'cross-reference-project-a',
      }),
    });
    const activation = await lifecycle.activateProject({
      requestId: 'cross-reference-activation-request',
      providerAdapter: provider,
    });
    assert.equal(activation.status, 'active');
    assert.equal(deliveredHandovers.length, 1);
    assert.equal(deliveredHandovers[0].payload.project.id, 'cross-reference-project-a');

    const activationCountBeforeReference = lifecycle.listActivations(
      'cross-reference-session',
    ).length;
    const deliveryCountBeforeReference = lifecycle.listDeliveryAttempts(
      'cross-reference-session',
    ).length;

    const reference = references.createCrossProjectReference({
      id: 'cross-reference-a-to-b',
      sourceProjectId: 'cross-reference-project-a',
      targetProjectId: 'cross-reference-project-b',
      label: 'Related research project',
      createdAt: '2026-11-06T15:00:00.000Z',
    });

    assert.deepEqual({ ...reference }, {
      id: 'cross-reference-a-to-b',
      sourceProjectId: 'cross-reference-project-a',
      targetProjectId: 'cross-reference-project-b',
      label: 'Related research project',
      createdAt: '2026-11-06T15:00:00.000Z',
    });
    assert.deepEqual(
      references.listCrossProjectReferences('cross-reference-project-a')
        .map((item) => item.id),
      ['cross-reference-a-to-b'],
    );

    // The reference API returns only reference metadata, never target-project
    // purpose, records, handover contents, credentials or permission data.
    assert.equal(Object.hasOwn(reference, 'purpose'), false);
    assert.equal(Object.hasOwn(reference, 'records'), false);
    assert.equal(Object.hasOwn(reference, 'handover'), false);
    assert.equal(Object.hasOwn(reference, 'credentials'), false);
    assert.equal(Object.hasOwn(reference, 'permissions'), false);

    // Merely recording the reference does not alter the Session lifecycle or
    // invoke another provider delivery.
    assert.equal(
      lifecycle.getActiveActivation('cross-reference-session').projectId,
      'cross-reference-project-a',
    );
    assert.equal(lifecycle.listActivations('cross-reference-session').length,
      activationCountBeforeReference);
    assert.equal(lifecycle.listActivations('cross-reference-session')
      .some((item) => item.projectId === 'cross-reference-project-b'), false);
    assert.equal(lifecycle.listDeliveryAttempts('cross-reference-session').length,
      deliveryCountBeforeReference);
    assert.equal(deliveredHandovers.length, 1);

    // A's handover remains scoped to A and contains no B records or B content.
    const projectAHandover = store.buildHandover('cross-reference-project-a');
    assert.equal(projectAHandover.project.id, 'cross-reference-project-a');
    assert.deepEqual(projectAHandover.records.map((record) => record.id), [
      'cross-reference-a-record',
    ]);
    assert.equal(JSON.stringify(projectAHandover)
      .includes('Private Project B record must not be disclosed.'), false);

    assert.throws(() => references.createCrossProjectReference({
      sourceProjectId: 'cross-reference-project-a',
      targetProjectId: 'cross-reference-project-a',
    }), /cannot reference itself/);

    assert.throws(() => references.createCrossProjectReference({
      sourceProjectId: 'cross-reference-project-a',
      targetProjectId: 'missing-project',
    }), /FOREIGN KEY constraint failed/);

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(() => inspect.prepare(
        "UPDATE cross_project_references SET label = 'rewritten' WHERE id = ?",
      ).run('cross-reference-a-to-b'), /append-only/);
      assert.throws(() => inspect.prepare(
        'DELETE FROM cross_project_references WHERE id = ?',
      ).run('cross-reference-a-to-b'), /append-only/);
    } finally {
      inspect.close();
    }
  } finally {
    lifecycle.close();
    references.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
