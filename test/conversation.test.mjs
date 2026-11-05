import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/store.mjs';

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-conversation-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  try {
    return run({ store, databasePath });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function seedSubstantiveConversation(store) {
  const project = store.createProject({
    id: 'conversation-project',
    name: 'DevBridge Conversation Simulation',
    purpose: 'Exercise continuity across a realistic sequence of user and AI contributions.',
  });

  const turns = [
    {
      id: 'turn-01-user-goal',
      category: 'requirement',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      content: 'I want DevBridge to preserve meaningful project context when I move between AI conversations and providers. It must not take control of project decisions or implementation.',
    },
    {
      id: 'turn-02-ai-git-proposal',
      category: 'proposal',
      originType: 'ai',
      originLabel: 'AI instance A (simulated conversation)',
      content: 'One possible approach is to require every DevBridge project to have a Git repository so project identity and history always have a repository anchor.',
      relatedRecords: [{ recordId: 'turn-01-user-goal', relationship: 'relates_to' }],
    },
    {
      id: 'turn-03-user-challenge',
      category: 'disagreement',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      content: 'I disagree with making Git mandatory. A project must be able to exist before a repository is created, and some users will not use Git at all.',
      relatedRecords: [{ recordId: 'turn-02-ai-git-proposal', relationship: 'contradicts' }],
    },
    {
      id: 'turn-04-ai-revised-proposal',
      category: 'proposal',
      originType: 'ai',
      originLabel: 'AI instance A (simulated conversation)',
      content: 'Revised proposal: give every project its own stable DevBridge identity. Treat repositories and folders as optional location references that can be connected later.',
      relatedRecords: [{ recordId: 'turn-03-user-challenge', relationship: 'relates_to' }],
    },
    {
      id: 'turn-05-user-decision',
      category: 'decision',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      content: 'Decision: project identity must be independent of Git, device, folder path and AI provider. Git remains optional.',
      relatedRecords: [{ recordId: 'turn-04-ai-revised-proposal', relationship: 'relates_to' }],
    },
    {
      id: 'turn-06-user-provider-requirement',
      category: 'requirement',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      content: 'Initial idea: support Claude, ChatGPT and other AI providers together in the first release.',
    },
    {
      id: 'turn-07-ai-scope-challenge',
      category: 'proposal',
      originType: 'ai',
      originLabel: 'AI instance B (simulated conversation)',
      content: 'For the first release, consider implementing one provider adapter while keeping the continuity core provider-independent. Additional adapters can follow without changing project records.',
      relatedRecords: [{ recordId: 'turn-06-user-provider-requirement', relationship: 'contradicts' }],
    },
    {
      id: 'turn-08-user-scope-change',
      category: 'change',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      content: 'Updated direction: limit the first release to one provider integration. Keep the core provider-independent so more providers can be added later.',
      relatedRecords: [
        { recordId: 'turn-06-user-provider-requirement', relationship: 'supersedes' },
        { recordId: 'turn-07-ai-scope-challenge', relationship: 'relates_to' },
      ],
    },
    {
      id: 'turn-09-ai-progress-report',
      category: 'status',
      originType: 'ai',
      originLabel: 'AI instance A (simulated conversation)',
      statusText: 'reported_in_simulation',
      content: 'Simulated progress report: a local prototype can create projects, append attributed records and produce a basic handover. This is a scenario statement, not a claim about the live repository.',
      relatedRecords: [{ recordId: 'turn-05-user-decision', relationship: 'relates_to' }],
    },
    {
      id: 'turn-10-user-open-question',
      category: 'status',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      statusText: 'unresolved',
      content: 'Open question: how should account identity and cross-device synchronisation work without making DevBridge the host of project files?',
    },
    {
      id: 'turn-11-ai-sync-proposal',
      category: 'proposal',
      originType: 'ai',
      originLabel: 'AI instance A (simulated conversation)',
      content: 'Proposal: keep project files in user-selected storage and synchronise only the project catalogue and continuity records.',
      relatedRecords: [{ recordId: 'turn-10-user-open-question', relationship: 'relates_to' }],
    },
    {
      id: 'turn-12-ai-alternative',
      category: 'proposal',
      originType: 'ai',
      originLabel: 'AI instance B (simulated conversation)',
      content: 'Alternative proposal: make a managed cloud workspace the primary source of project files and continuity data.',
      relatedRecords: [{ recordId: 'turn-11-ai-sync-proposal', relationship: 'contradicts' }],
    },
    {
      id: 'turn-13-user-no-decision',
      category: 'status',
      originType: 'user',
      originLabel: 'User (simulated conversation)',
      statusText: 'unresolved',
      content: 'No decision yet on the synchronisation architecture. Preserve both AI proposals and leave this question open for further investigation.',
      relatedRecords: [
        { recordId: 'turn-11-ai-sync-proposal', relationship: 'relates_to' },
        { recordId: 'turn-12-ai-alternative', relationship: 'relates_to' },
      ],
    },
  ];

  const conversationStartedAt = Date.now();
  for (const turn of turns) {
    const sequence = Number(turn.id.slice(5, 7));
    store.appendRecord({
      projectId: project.id,
      recordedAt: new Date(conversationStartedAt + sequence * 1000).toISOString(),
      ...turn,
    });
  }

  return { project, turns };
}

test('preserves a substantive simulated conversation, including challenges, changes and unresolved alternatives', () => withStore(({ store, databasePath }) => {
  const { project, turns } = seedSubstantiveConversation(store);
  const records = store.listRecords(project.id);

  assert.equal(records.length, turns.length);
  assert.deepEqual(records.map((record) => record.id), turns.map((turn) => turn.id));

  const byId = new Map(records.map((record) => [record.id, record]));
  assert.equal(byId.get('turn-01-user-goal').originType, 'user');
  assert.equal(byId.get('turn-02-ai-git-proposal').originType, 'ai');
  assert.equal(byId.get('turn-03-user-challenge').category, 'disagreement');
  assert.equal(byId.get('turn-05-user-decision').category, 'decision');

  // The earlier requirement remains present after the user's later change.
  assert.match(byId.get('turn-06-user-provider-requirement').content, /Claude, ChatGPT/);
  assert.match(byId.get('turn-08-user-scope-change').content, /one provider integration/);

  // Unresolved alternatives remain attributed to their separate AI contributors.
  assert.equal(byId.get('turn-10-user-open-question').statusText, 'unresolved');
  assert.equal(byId.get('turn-11-ai-sync-proposal').originLabel, 'AI instance A (simulated conversation)');
  assert.equal(byId.get('turn-12-ai-alternative').originLabel, 'AI instance B (simulated conversation)');
  assert.equal(byId.get('turn-13-user-no-decision').statusText, 'unresolved');

  const db = new DatabaseSync(databasePath);
  let links;
  try {
    links = db.prepare(`
      SELECT from_record_id AS fromRecordId, to_record_id AS toRecordId, relationship
      FROM record_links
      WHERE project_id = ?
      ORDER BY created_at, id
    `).all(project.id);
  } finally {
    db.close();
  }

  assert.equal(links.length, 12);
  assert.ok(links.some((link) =>
    link.fromRecordId === 'turn-03-user-challenge'
    && link.toRecordId === 'turn-02-ai-git-proposal'
    && link.relationship === 'contradicts'));
  assert.ok(links.some((link) =>
    link.fromRecordId === 'turn-08-user-scope-change'
    && link.toRecordId === 'turn-06-user-provider-requirement'
    && link.relationship === 'supersedes'));
  assert.ok(links.some((link) =>
    link.fromRecordId === 'turn-12-ai-alternative'
    && link.toRecordId === 'turn-11-ai-sync-proposal'
    && link.relationship === 'contradicts'));

  const handover = store.buildHandover(project.id);
  assert.equal(handover.format, 'devbridge-handover-v2');
  assert.equal(handover.recordCountKnown, 13);
  assert.equal(handover.recordCountIncluded, 13);
  assert.equal(handover.hasOlderRecords, false);
  assert.equal(handover.records[0].id, 'turn-01-user-goal');
  assert.equal(handover.records.at(-1).id, 'turn-13-user-no-decision');
  assert.equal(handover.completeness, 'recorded_context_only');

  // The initial kernel is identity and purpose only. No principle is inferred.
  assert.equal(handover.kernel.projectId, project.id);
  assert.equal(handover.kernel.name, project.name);
  assert.equal(handover.kernel.purpose, project.purpose);
  assert.deepEqual(handover.kernel.principles, []);

  // Current state is an index of stored evidence, not a judgement or resolution.
  assert.equal(handover.currentState.basis, 'index_of_included_records_only');
  assert.deepEqual(handover.currentState.recordIdsByCategory.decision, ['turn-05-user-decision']);
  assert.deepEqual(handover.currentState.unresolvedRecordIds, [
    'turn-10-user-open-question',
    'turn-13-user-no-decision',
  ]);
  assert.deepEqual(handover.currentState.reportedStatusRecordIds, ['turn-09-ai-progress-report']);
  assert.deepEqual(handover.currentState.supersededRecordIds, ['turn-06-user-provider-requirement']);

  // The handover carries the relationship graph and preserves edge direction.
  assert.equal(handover.history.relationships.length, 12);
  assert.ok(handover.history.relationships.some((link) =>
    link.fromRecordId === 'turn-12-ai-alternative'
    && link.toRecordId === 'turn-11-ai-sync-proposal'
    && link.relationship === 'contradicts'
    && link.fromIncluded === true
    && link.toIncluded === true));
  assert.equal(handover.history.events.length, 14);
  assert.equal(handover.history.eventCountKnown, 14);
  assert.equal(handover.history.hasOlderEvents, false);
  assert.match(handover.notice, /not independently verified/);
}));

test('bounded handover discloses omitted history and marks relationship endpoints outside the included records', () => withStore(({ store }) => {
  const { project } = seedSubstantiveConversation(store);
  const handover = store.buildHandover(project.id, { recordLimit: 3, eventLimit: 2 });

  assert.equal(handover.recordCountIncluded, 3);
  assert.equal(handover.recordCountKnown, 13);
  assert.equal(handover.hasOlderRecords, true);
  assert.equal(handover.history.eventCountIncluded, 2);
  assert.equal(handover.history.eventCountKnown, 14);
  assert.equal(handover.history.hasOlderEvents, true);
  assert.ok(handover.history.relationships.some((link) =>
    link.fromRecordId === 'turn-11-ai-sync-proposal'
    && link.toRecordId === 'turn-10-user-open-question'
    && link.fromIncluded === true
    && link.toIncluded === false));
  assert.ok(!handover.currentState.recordIdsByCategory.requirement.includes('turn-06-user-provider-requirement'));
  assert.deepEqual(handover.currentState.supersededRecordIds, []);
}));
