import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { openStore } from '../src/store.mjs';

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-local-sync-test-'));
  const databasePath = join(directory, 'devbridge.sqlite');
  const store = openStore(databasePath);
  try {
    return run({ store, databasePath });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('local sync identity is explicit and stable for one installation', () => withStore(({ store }) => {
  assert.equal(store.getLocalSyncDevice(), null);
  const first = store.configureLocalSyncDevice({ deviceId: 'device-a', createdAt: '2026-11-06T10:00:00.000Z' });
  assert.equal(first.deviceId, 'device-a');
  assert.deepEqual(store.configureLocalSyncDevice(), first);
  assert.throws(() => store.configureLocalSyncDevice({ deviceId: 'device-b' }), /already configured/);
}));

test('Project sync requires explicit device setup and refuses implicit adoption of existing history', () => withStore(({ store }) => {
  store.createProject({ id: 'existing', name: 'Existing project' });
  assert.throws(() => store.enableProjectSync('existing'), /Configure the local sync device/);
  store.configureLocalSyncDevice({ deviceId: 'device-a' });
  store.appendRecord({
    id: 'legacy-record', projectId: 'existing', category: 'decision',
    content: 'Pre-existing history', originType: 'user',
  });
  assert.throws(() => store.enableProjectSync('existing'), /bootstrap for existing history is not implemented/);
  assert.equal(store.getProjectSyncStatus('existing'), null);
  assert.deepEqual(store.listSyncOutbox(), []);
}));

test('sync-enabled local contribution and durable outbox are created atomically', () => withStore(({ store }) => {
  store.configureLocalSyncDevice({ deviceId: 'device-a' });
  store.createProject({ id: 'p1', name: 'Sync project', purpose: 'Local outbox test' });
  assert.deepEqual(store.enableProjectSync('p1'), {
    projectId: 'p1', status: 'enabled', enabledAt: store.getProjectSyncStatus('p1').enabledAt,
  });

  store.appendRecord({
    id: 'r1', projectId: 'p1', category: 'decision',
    content: 'First synchronised contribution', originType: 'user',
    recordedAt: '2026-11-06T10:01:00.000Z',
  });
  const firstOutbox = store.listSyncOutbox({ projectId: 'p1' });
  assert.equal(firstOutbox.length, 1);
  assert.equal(firstOutbox[0].deviceProjectSequence, 1);
  assert.equal(firstOutbox[0].state, 'pending_seal');
  const first = store.getSyncContribution(firstOutbox[0].contributionId);
  assert.equal(first.payload.format, 'devbridge-sync-contribution-v1');
  assert.equal(first.payload.originDeviceId, 'device-a');
  assert.equal(first.payload.projectId, 'p1');
  assert.deepEqual(first.payload.dependencies, []);
  assert.deepEqual(first.payload.events.map((event) => event.eventType), ['project_created', 'record_added']);

  store.appendRecord({
    id: 'r2', projectId: 'p1', category: 'change',
    content: 'Second contribution linked to the first', originType: 'user',
    relatedRecords: [{ recordId: 'r1', relationship: 'supersedes' }],
    recordedAt: '2026-11-06T10:02:00.000Z',
  });
  const all = store.listSyncOutbox({ projectId: 'p1' });
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((item) => item.deviceProjectSequence), [1, 2]);
  const second = store.getSyncContribution(all[1].contributionId);
  assert.deepEqual(second.payload.dependencies, [first.contributionId]);
  assert.equal(second.payload.links[0].toRecordId, 'r1');
  assert.deepEqual(second.payload.events.map((event) => event.eventType), ['record_added']);
}));

test('failed sync-enabled contribution leaves no record, event, sequence, or outbox item', () => withStore(({ store }) => {
  store.configureLocalSyncDevice({ deviceId: 'device-a' });
  store.createProject({ id: 'p1', name: 'Atomic sync test' });
  store.enableProjectSync('p1');

  assert.throws(() => store.appendRecord({
    id: 'invalid', projectId: 'p1', category: 'decision',
    content: 'This must roll back', originType: 'user',
    relatedRecords: [{ recordId: 'missing-record', relationship: 'relates_to' }],
  }), /Related record does not exist/);

  assert.equal(store.getRecord('invalid'), null);
  assert.equal(store.listEvents('p1').length, 1);
  assert.deepEqual(store.listSyncOutbox(), []);

  store.appendRecord({
    id: 'valid', projectId: 'p1', category: 'decision',
    content: 'First valid contribution', originType: 'user',
  });
  assert.equal(store.listSyncOutbox()[0].deviceProjectSequence, 1);
}));
