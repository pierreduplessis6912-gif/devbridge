#!/usr/bin/env node

/**
 * DevBridge native node:sqlite compatibility probe.
 *
 * This is a disposable environment check, not application code.
 * It verifies that the current Node runtime can:
 * - import node:sqlite without an external package;
 * - create and write a SQLite database;
 * - commit and roll back a transaction;
 * - close the database and read it from a fresh Node process;
 * - run PRAGMA integrity_check.
 *
 * Usage:
 *   node scripts/probe-node-sqlite.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function verifyFromFreshProcess(databasePath) {
  const db = new DatabaseSync(databasePath);

  try {
    const row = db
      .prepare('SELECT value FROM probe_records WHERE record_key = ?')
      .get('committed');

    const integrity = db.prepare('PRAGMA integrity_check').get();
    const integrityValue = integrity ? Object.values(integrity)[0] : undefined;

    assert.equal(row?.value, 'read-from-fresh-process');
    assert.equal(integrityValue, 'ok');

    process.stdout.write(
      JSON.stringify({
        freshProcessRead: row.value,
        integrityCheck: integrityValue,
      }),
    );
  } finally {
    db.close();
  }
}

if (process.argv[2] === '--verify') {
  try {
    verifyFromFreshProcess(process.argv[3]);
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  }
} else {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-sqlite-probe-'));
  const databasePath = join(directory, 'probe.sqlite');

  try {
    const db = new DatabaseSync(databasePath);

    try {
      db.exec(`
        CREATE TABLE probe_records (
          record_key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const insert = db.prepare(
        'INSERT INTO probe_records (record_key, value) VALUES (?, ?)',
      );

      // A rolled-back write must not remain in the database.
      db.exec('BEGIN IMMEDIATE');
      insert.run('rolled-back', 'must-not-exist');
      db.exec('ROLLBACK');

      const rolledBack = db
        .prepare('SELECT value FROM probe_records WHERE record_key = ?')
        .get('rolled-back');

      assert.equal(rolledBack, undefined);

      // A committed write must survive closing and reopening the database.
      db.exec('BEGIN IMMEDIATE');
      insert.run('committed', 'read-from-fresh-process');
      db.exec('COMMIT');
    } finally {
      db.close();
    }

    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), '--verify', databasePath],
      { encoding: 'utf8' },
    );

    assert.equal(
      child.status,
      0,
      child.stderr || `Fresh-process verification exited with ${child.status}`,
    );

    const freshProcessResult = JSON.parse(child.stdout);

    process.stdout.write(
      JSON.stringify(
        {
          result: 'PASS',
          runtime: process.version,
          module: 'node:sqlite',
          transactionRollback: 'PASS',
          transactionCommit: 'PASS',
          ...freshProcessResult,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
