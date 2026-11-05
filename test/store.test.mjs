import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openStore } from '../src/store.mjs';

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-store-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  try {
    return run({ store, databasePath });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('creates independent projects and lists them', () => withStore(({ store }) => {
  const first = store.createProject({ id: 'p1', name: 'First', purpose: 'A test project' });
  const second = store.createProject({ id: 'p2', name: 'Second' });

  assert.equal(first.id, 'p1');
  assert.equal(first.purpose, 'A test project');
  assert.deepEqual(store.listProjects().map((project) => project.id).sort(), ['p1', 'p2']);
  assert.equal(store.getProject('missing'), null);
}));

test('preserves user and AI contributions as distinct append-only records', () => withStore(({ store }) => {
  store.createProject({ id: 'p1', name: 'Continuity test' });

  const user = store.appendRecord({
    id: 'r1',
    projectId: 'p1',
    category: 'decision',
    content: 'The user prefers option A.',
    originType: 'user',
    originLabel: 'Project owner',
  });
  const ai = store.appendRecord({
    id: 'r2',
    projectId: 'p1',
    category: 'proposal',
    content: 'The AI recommends option B.',
    originType: 'ai',
    originLabel: 'Claude',
    relatedRecords: [{ recordId: 'r1', relationship: 'contradicts' }],
  });

  assert.equal(user.originType, 'user');
  assert.equal(ai.originType, 'ai');
  assert.deepEqual(store.listRecords('p1').map((record) => record.id), ['r1', 'r2']);
  assert.equal(store.listEvents('p1').length, 3);
}));

test('appends a new record instead of replacing a previous position', () => withStore(({ store }) => {
  store.createProject({ id: 'p1', name: 'History test' });
  store.appendRecord({
    id: 'old',
    projectId: 'p1',
    category: 'decision',
    content: 'Earlier position.',
    originType: 'user',
  });
  store.appendRecord({
    id: 'new',
    projectId: 'p1',
    category: 'change',
    content: 'The position has changed.',
    originType: 'user',
    relatedRecords: [{ recordId: 'old', relationship: 'supersedes' }],
  });

  assert.equal(store.getRecord('old').content, 'Earlier position.');
  assert.equal(store.getRecord('new').content, 'The position has changed.');
}));

test('rejects an invalid contribution without leaving a partial event', () => withStore(({ store }) => {
  store.createProject({ id: 'p1', name: 'Atomicity test' });

  assert.throws(() => store.appendRecord({
    projectId: 'p1',
    category: 'decision',
    content: 'A record with an invalid cross-project link.',
    originType: 'user',
    relatedRecords: [{ recordId: 'does-not-exist', relationship: 'relates_to' }],
  }), /Related record does not exist/);

  assert.equal(store.listRecords('p1').length, 0);
  assert.equal(store.listEvents('p1').length, 1);
}));

test('does not permit silent mutation of historical records', () => withStore(({ store, databasePath }) => {
  store.createProject({ id: 'p1', name: 'Immutability test' });
  store.appendRecord({
    id: 'r1',
    projectId: 'p1',
    category: 'status',
    content: 'Recorded status.',
    originType: 'ai',
  });
  store.close();

  const script = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    try {
      db.prepare("UPDATE project_records SET content = 'rewritten' WHERE id = 'r1'").run();
      process.exitCode = 2;
    } catch (error) {
      if (!String(error.message).includes('append-only')) throw error;
    } finally {
      db.close();
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, databasePath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}));

test('builds a bounded handover and discloses older records', () => withStore(({ store }) => {
  store.createProject({ id: 'p1', name: 'Handover test' });
  for (let i = 1; i <= 3; i += 1) {
    store.appendRecord({
      id: `r${i}`,
      projectId: 'p1',
      category: 'user_contribution',
      content: `Contribution ${i}`,
      originType: 'user',
      recordedAt: `2026-11-05T10:00:0${i}.000Z`,
    });
  }

  const handover = store.buildHandover('p1', { recordLimit: 2 });
  assert.deepEqual(handover.records.map((record) => record.id), ['r2', 'r3']);
  assert.equal(handover.recordCountKnown, 3);
  assert.equal(handover.hasOlderRecords, true);
  assert.equal(handover.completeness, 'recorded_context_only');
}));
