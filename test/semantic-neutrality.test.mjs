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

test('SLA-10: differing concurrent contributions remain neutral until an attributed contribution records a relationship', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-semantic-neutrality-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  const authority = createSimulatedConfirmationAuthority();
  const firstLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const secondLifecycle = openSessionLifecycle(databasePath, store, { confirmationAuthority: authority });
  const provider = createSimulatedProvider({
    outcomes: ['acknowledged', 'acknowledged', 'acknowledged'],
  });

  const activate = async (lifecycle, sessionId, requestId) => {
    lifecycle.createSession({ id: sessionId });
    lifecycle.requestProjectActivation({
      sessionId, projectId: 'semantic-neutrality-project', requestId,
    });
    await lifecycle.confirmProjectActivation({
      requestId,
      confirmationToken: authority.issue({
        requestId, sessionId, projectId: 'semantic-neutrality-project',
      }),
    });
    return lifecycle.activateProject({ requestId, providerAdapter: provider });
  };

  try {
    store.createProject({
      id: 'semantic-neutrality-project',
      name: 'Semantic Neutrality Project',
    });
    const first = await activate(
      firstLifecycle, 'neutral-session-one', 'neutral-request-one',
    );
    const second = await activate(
      secondLifecycle, 'neutral-session-two', 'neutral-request-two',
    );
    assert.equal(first.status, 'active');
    assert.equal(second.status, 'active');

    const firstSubmission = firstLifecycle.prepareContribution({
      id: 'neutral-record-one',
      sessionId: 'neutral-session-one',
      category: 'user_contribution',
      content: 'The delivery date is 12 November.',
      originType: 'user',
      originLabel: 'project-owner',
      sourceRef: 'owner-statement',
      recordedAt: '2026-11-06T14:00:00.000Z',
    });
    const secondSubmission = secondLifecycle.prepareContribution({
      id: 'neutral-record-two',
      sessionId: 'neutral-session-two',
      category: 'ai_contribution',
      content: 'The delivery date is 19 November.',
      originType: 'ai',
      originLabel: 'assistant-session',
      sourceRef: 'assistant-estimate',
      recordedAt: '2026-11-06T14:00:00.001Z',
    });

    // Both statements are reserved while both activations are current.
    // The first commit then makes the second activation stale, but does not
    // convert the difference into a semantic judgement.
    firstLifecycle.commitContribution({ intentId: firstSubmission.intentId });
    secondLifecycle.commitContribution({ intentId: secondSubmission.intentId });

    const firstRecord = store.getRecord('neutral-record-one');
    const secondRecord = store.getRecord('neutral-record-two');
    assert.equal(firstRecord.content, 'The delivery date is 12 November.');
    assert.equal(secondRecord.content, 'The delivery date is 19 November.');
    assert.equal(firstRecord.category, 'user_contribution');
    assert.equal(secondRecord.category, 'ai_contribution');
    assert.equal(firstRecord.sessionId, 'neutral-session-one');
    assert.equal(secondRecord.sessionId, 'neutral-session-two');
    assert.equal(firstRecord.activationId, first.activation.id);
    assert.equal(secondRecord.activationId, second.activation.id);

    const firstMarkers = firstLifecycle.listStalenessMarkers('neutral-session-one');
    const secondMarkers = secondLifecycle.listStalenessMarkers('neutral-session-two');
    assert.equal(firstMarkers.length, 1);
    assert.equal(secondMarkers.length, 1);
    assert.equal(firstMarkers[0].newerRecordId, secondRecord.id);
    assert.equal(secondMarkers[0].newerRecordId, firstRecord.id);

    const inspect = new DatabaseSync(databasePath);
    try {
      const automaticLinks = inspect.prepare(
        'SELECT * FROM record_links WHERE project_id = ?',
      ).all('semantic-neutrality-project');
      assert.deepEqual(automaticLinks, []);

      const conflictEvents = inspect.prepare(`
        SELECT * FROM project_events
        WHERE project_id = ?
          AND lower(event_type) LIKE '%conflict%'
      `).all('semantic-neutrality-project');
      assert.deepEqual(conflictEvents, []);

      const semanticConflictTables = inspect.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND lower(name) LIKE '%conflict%'
      `).all();
      assert.deepEqual(semanticConflictTables, []);
    } finally {
      inspect.close();
    }

    // An explicit relationship is recorded only when a new attributed
    // contribution is deliberately submitted after the activation refreshes.
    const refreshed = await firstLifecycle.refreshStaleActivation({
      sessionId: 'neutral-session-one',
      providerAdapter: provider,
    });
    assert.equal(refreshed.status, 'refreshed');
    const explicitDisagreement = firstLifecycle.recordContribution({
      id: 'neutral-explicit-disagreement',
      sessionId: 'neutral-session-one',
      category: 'disagreement',
      content: 'The delivery dates differ; the owner statement and assistant estimate need confirmation.',
      originType: 'user',
      originLabel: 'project-owner',
      sourceRef: 'explicit-disagreement-entry',
      relatedRecords: [
        { recordId: 'neutral-record-two', relationship: 'contradicts' },
      ],
      recordedAt: '2026-11-06T14:05:00.000Z',
    });

    assert.equal(explicitDisagreement.category, 'disagreement');
    assert.equal(explicitDisagreement.sessionId, 'neutral-session-one');
    assert.equal(explicitDisagreement.activationId, first.activation.id);
    assert.equal(explicitDisagreement.handoverSnapshotId, first.handoverId);
    assert.equal(explicitDisagreement.originType, 'user');
    assert.equal(explicitDisagreement.sourceRef, 'explicit-disagreement-entry');

    const verify = new DatabaseSync(databasePath);
    try {
      const explicitLinks = verify.prepare(`
        SELECT from_record_id AS fromRecordId, to_record_id AS toRecordId,
          relationship
        FROM record_links
        WHERE from_record_id = ?
      `).all(explicitDisagreement.id).map((row) => ({ ...row }));
      assert.deepEqual(explicitLinks, [{
        fromRecordId: 'neutral-explicit-disagreement',
        toRecordId: 'neutral-record-two',
        relationship: 'contradicts',
      }]);
    } finally {
      verify.close();
    }
  } finally {
    firstLifecycle.close();
    secondLifecycle.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
