import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
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

test('outbox insertion failure rolls back the local record, event, and device sequence', () => withStore(({ store, databasePath }) => {
  store.configureLocalSyncDevice({ deviceId: 'device-a' });
  store.createProject({ id: 'p1', name: 'Outbox rollback test' });
  store.enableProjectSync('p1');

  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TRIGGER fail_sync_outbox_insert
    BEFORE INSERT ON sync_outbox
    BEGIN
      SELECT RAISE(ABORT, 'simulated outbox failure');
    END;
  `);
  db.close();

  assert.throws(() => store.appendRecord({
    id: 'must-rollback', projectId: 'p1', category: 'decision',
    content: 'The local record and outbox must commit together', originType: 'user',
  }), /simulated outbox failure/);

  assert.equal(store.getRecord('must-rollback'), null);
  assert.equal(store.listEvents('p1').length, 1);
  assert.deepEqual(store.listSyncOutbox(), []);

  const cleanup = new DatabaseSync(databasePath);
  cleanup.exec('DROP TRIGGER fail_sync_outbox_insert');
  cleanup.close();

  store.appendRecord({
    id: 'after-rollback', projectId: 'p1', category: 'decision',
    content: 'The sequence should still begin at one', originType: 'user',
  });
  assert.equal(store.listSyncOutbox()[0].deviceProjectSequence, 1);
}));


test('incoming envelope receipt preserves exact bytes and records a SHA-256 digest without accepting content', () => withStore(({ store }) => {
  const envelope = '  {"opaque":"ciphertext","version":1}\\n';
  const result = store.receiveSyncEnvelope({
    contributionId: 'remote-c1',
    projectId: 'p1',
    originDeviceId: 'remote-device',
    deviceProjectSequence: 1,
    envelope,
    receivedAt: '2026-11-06T11:00:00.000Z',
  });

  assert.equal(result.state, 'received');
  assert.equal(result.integrityConflict, false);
  assert.equal(result.duplicate, false);
  const receipt = store.getSyncInboxReceipt(result.receiptId);
  assert.equal(receipt.envelope, envelope);
  assert.equal(receipt.envelopeSha256, createHash('sha256').update(envelope, 'utf8').digest('hex'));
  assert.equal(store.getProject('p1'), null);
  assert.equal(store.listRecords('p1').length, 0);
  assert.equal(store.getSyncAppliedContribution('remote-c1'), null);
}));

test('repeated exact incoming envelope is idempotent', () => withStore(({ store }) => {
  const input = {
    contributionId: 'remote-c1',
    projectId: 'p1',
    originDeviceId: 'remote-device',
    deviceProjectSequence: 1,
    envelope: '{"same":"bytes"}',
    receivedAt: '2026-11-06T11:00:00.000Z',
  };
  const first = store.receiveSyncEnvelope(input);
  const second = store.receiveSyncEnvelope({ ...input, receivedAt: '2026-11-06T11:01:00.000Z' });

  assert.equal(second.receiptId, first.receiptId);
  assert.equal(second.duplicate, true);
  assert.equal(second.state, 'received');
  assert.equal(store.listSyncInbox().length, 1);
}));

test('same contribution identity with different envelope bytes is quarantined', () => withStore(({ store }) => {
  const identity = {
    contributionId: 'remote-c1',
    projectId: 'p1',
    originDeviceId: 'remote-device',
    deviceProjectSequence: 1,
  };
  const first = store.receiveSyncEnvelope({ ...identity, envelope: '{"value":1}' });
  const conflict = store.receiveSyncEnvelope({ ...identity, envelope: '{"value":2}' });

  assert.equal(conflict.integrityConflict, true);
  assert.equal(conflict.state, 'quarantined');
  assert.equal(conflict.lastErrorCode, 'contribution_identity_conflict');
  assert.equal(store.listSyncInbox().length, 2);
  assert.deepEqual(store.listSyncInbox().map((item) => item.state), ['quarantined', 'quarantined']);
  assert.equal(store.getSyncInboxReceipt(first.receiptId).envelope, '{"value":1}');
  assert.equal(store.getSyncInboxReceipt(conflict.receiptId).envelope, '{"value":2}');
}));

test('one origin Project sequence cannot be assigned to different contributions', () => withStore(({ store }) => {
  const common = {
    projectId: 'p1',
    originDeviceId: 'remote-device',
    deviceProjectSequence: 7,
  };
  const first = store.receiveSyncEnvelope({
    ...common, contributionId: 'remote-c1', envelope: '{"value":1}',
  });
  const conflict = store.receiveSyncEnvelope({
    ...common, contributionId: 'remote-c2', envelope: '{"value":2}',
  });

  assert.equal(conflict.integrityConflict, true);
  assert.equal(conflict.lastErrorCode, 'origin_sequence_conflict');
  assert.deepEqual(store.listSyncInbox().map((item) => item.state), ['quarantined', 'quarantined']);
  assert.equal(store.getSyncInboxReceipt(first.receiptId).envelope, '{"value":1}');
}));

test('incoming envelope receipt validates routing metadata and non-empty exact envelope', () => withStore(({ store }) => {
  const base = {
    contributionId: 'remote-c1',
    projectId: 'p1',
    originDeviceId: 'remote-device',
    deviceProjectSequence: 1,
    envelope: '{"opaque":true}',
  };
  assert.throws(() => store.receiveSyncEnvelope({ ...base, envelope: '' }), /non-empty string/);
  assert.throws(() => store.receiveSyncEnvelope({ ...base, deviceProjectSequence: 0 }), /positive safe integer/);
  assert.throws(() => store.receiveSyncEnvelope({ ...base, contributionId: ' ' }), /non-empty string/);
  assert.throws(() => store.listSyncInbox({ state: 'unknown' }), /state must be/);
  assert.deepEqual(store.listSyncInbox(), []);
}));
