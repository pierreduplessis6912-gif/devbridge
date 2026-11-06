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

test('SLA-09: overlapping Session submissions are both retained with distinct attribution', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-concurrent-contributions-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({ outcomes: ['acknowledged', 'acknowledged'] });

  const activate = async (lifecycle, sessionId, requestId) => {
    lifecycle.createSession({ id: sessionId });
    lifecycle.requestProjectActivation({
      sessionId, projectId: 'concurrent-project', requestId,
    });
    await lifecycle.confirmProjectActivation({
      requestId,
      confirmationToken: authority.issue({
        requestId, sessionId, projectId: 'concurrent-project',
      }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({ id: 'concurrent-project', name: 'Concurrent Project' });
    const first = await activate(firstLifecycle, 'concurrent-session-one', 'concurrent-request-one');
    const second = await activate(secondLifecycle, 'concurrent-session-two', 'concurrent-request-two');
    assert.equal(first.status, 'active');
    assert.equal(second.status, 'active');

    const initialBoundary = store.getProjectHistoryBoundary('concurrent-project').eventSequence;
    const firstIntent = firstLifecycle.prepareContribution({
      id: 'concurrent-record-one',
      sessionId: 'concurrent-session-one',
      category: 'decision',
      content: 'Session One submitted its decision.',
      originType: 'user',
      originLabel: 'session-one-user',
      sourceRef: 'session-one-submission',
      recordedAt: '2026-11-06T13:00:00.000Z',
    });
    const secondIntent = secondLifecycle.prepareContribution({
      id: 'concurrent-record-two',
      sessionId: 'concurrent-session-two',
      category: 'proposal',
      content: 'Session Two submitted its independent proposal.',
      originType: 'ai',
      originLabel: 'session-two-model',
      sourceRef: 'session-two-submission',
      recordedAt: '2026-11-06T13:00:00.001Z',
    });

    // Both submissions are durably reserved against the same current Project
    // boundary before either contribution is committed.
    assert.equal(firstIntent.projectEventSequence, initialBoundary);
    assert.equal(secondIntent.projectEventSequence, initialBoundary);
    assert.equal(firstLifecycle.listContributionIntents('concurrent-session-one')[0].status, 'pending');
    assert.equal(secondLifecycle.listContributionIntents('concurrent-session-two')[0].status, 'pending');

    // Commit in an order that makes the first commit mark the other activation
    // stale before the second already-submitted contribution is committed.
    const committedFirst = firstLifecycle.commitContribution({ intentId: firstIntent.intentId });
    const markersForSecond = secondLifecycle.listStalenessMarkers('concurrent-session-two');
    assert.equal(markersForSecond.length, 1);
    assert.equal(markersForSecond[0].newerRecordId, committedFirst.id);
    assert.equal(markersForSecond[0].sourceSessionId, 'concurrent-session-one');

    const committedSecond = secondLifecycle.commitContribution({ intentId: secondIntent.intentId });
    const markersForFirst = firstLifecycle.listStalenessMarkers('concurrent-session-one');
    assert.equal(markersForFirst.length, 1);
    assert.equal(markersForFirst[0].newerRecordId, committedSecond.id);
    assert.equal(markersForFirst[0].sourceSessionId, 'concurrent-session-two');

    assert.deepEqual(
      [committedFirst.id, committedSecond.id].sort(),
      ['concurrent-record-one', 'concurrent-record-two'],
    );
    assert.deepEqual(
      [store.getRecord('concurrent-record-one'), store.getRecord('concurrent-record-two')]
        .map((record) => ({
          sessionId: record.sessionId,
          activationId: record.activationId,
          handoverSnapshotId: record.handoverSnapshotId,
          originType: record.originType,
          originLabel: record.originLabel,
          sourceRef: record.sourceRef,
        })),
      [
        {
          sessionId: 'concurrent-session-one',
          activationId: first.activation.id,
          handoverSnapshotId: first.handoverId,
          originType: 'user',
          originLabel: 'session-one-user',
          sourceRef: 'session-one-submission',
        },
        {
          sessionId: 'concurrent-session-two',
          activationId: second.activation.id,
          handoverSnapshotId: second.handoverId,
          originType: 'ai',
          originLabel: 'session-two-model',
          sourceRef: 'session-two-submission',
        },
      ],
    );

    assert.equal(firstLifecycle.listContributionIntents('concurrent-session-one')[0].status, 'committed');
    assert.equal(secondLifecycle.listContributionIntents('concurrent-session-two')[0].status, 'committed');
    assert.equal(firstLifecycle.getActiveActivation('concurrent-session-one').id, first.activation.id);
    assert.equal(secondLifecycle.getActiveActivation('concurrent-session-two').id, second.activation.id);

    // Once both in-flight submissions are complete, new submissions are gated
    // for each stale activation until its own fresh handover is acknowledged.
    assert.throws(() => firstLifecycle.prepareContribution({
      sessionId: 'concurrent-session-one',
      category: 'status',
      content: 'A later continuation must wait for refresh.',
      originType: 'user',
    }), /stale Project context must be refreshed/);
    assert.throws(() => secondLifecycle.recordContribution({
      sessionId: 'concurrent-session-two',
      category: 'status',
      content: 'A later continuation must wait for refresh.',
      originType: 'user',
    }), /stale Project context must be refreshed/);

    // A caller cannot bypass the reservation rule by writing directly to the store.
    assert.throws(() => store.appendRecord({
      id: 'concurrent-direct-bypass',
      projectId: 'concurrent-project',
      category: 'status',
      content: 'Direct store bypass must be rejected.',
      originType: 'user',
      sessionId: 'concurrent-session-one',
      activationId: first.activation.id,
      handoverSnapshotId: first.handoverId,
    }), /stale Project context must be refreshed/);

    const laterHandover = store.buildHandover('concurrent-project');
    const includedIds = laterHandover.records.map((record) => record.id);
    assert.ok(includedIds.includes('concurrent-record-one'));
    assert.ok(includedIds.includes('concurrent-record-two'));
    const firstStored = store.getRecord('concurrent-record-one');
    const secondStored = store.getRecord('concurrent-record-two');
    assert.equal(firstStored.projectId, secondStored.projectId);
    assert.notEqual(firstStored.sessionId, secondStored.sessionId);
    assert.notEqual(firstStored.activationId, secondStored.activationId);

    const inspect = new DatabaseSync(databasePath);
    try {
      assert.throws(
        () => inspect.prepare("UPDATE contribution_intents SET created_at = 'changed'").run(),
        /append-only/,
      );
      assert.throws(
        () => inspect.prepare('DELETE FROM contribution_intents').run(),
        /append-only/,
      );
    } finally {
      inspect.close();
    }
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
