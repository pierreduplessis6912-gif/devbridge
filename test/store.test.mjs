import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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

test('database enforces same-project links and append-only relationship history', () => withStore(({ store, databasePath }) => {
  store.createProject({ id: 'p1', name: 'First project' });
  store.createProject({ id: 'p2', name: 'Second project' });
  store.appendRecord({ id: 'r1', projectId: 'p1', category: 'decision', content: 'First project record.', originType: 'user' });
  store.appendRecord({ id: 'r2', projectId: 'p2', category: 'decision', content: 'Second project record.', originType: 'user' });
  store.appendRecord({
    id: 'r3', projectId: 'p1', category: 'change', content: 'A linked record.', originType: 'user',
    relatedRecords: [{ recordId: 'r1', relationship: 'supersedes' }],
  });
  store.close();

  // Simulate an existing v1 database so the upgrade path is exercised.
  const downgrade = new DatabaseSync(databasePath);
  downgrade.exec(`
    DROP TRIGGER record_links_same_project_insert;
    DROP TRIGGER record_links_no_update;
    DROP TRIGGER record_links_no_delete;
    PRAGMA user_version = 1;
  `);
  downgrade.close();

  const migratedStore = openStore(databasePath);
  migratedStore.close();

  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const linkId = db.prepare('SELECT id FROM record_links WHERE from_record_id = ?').get('r3').id;
    assert.throws(() => db.prepare(`
      INSERT INTO record_links (id, project_id, from_record_id, to_record_id, relationship, created_at)
      VALUES ('cross-project-link', 'p1', 'r1', 'r2', 'relates_to', '2026-11-05T12:00:00.000Z')
    `).run(), /same project/);
    assert.throws(() => db.prepare('UPDATE record_links SET relationship = ? WHERE id = ?').run('contradicts', linkId), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM record_links WHERE id = ?').run(linkId), /append-only/);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  } finally {
    db.close();
  }
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
