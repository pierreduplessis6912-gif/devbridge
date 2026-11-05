import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const cliPath = new URL('../src/cli.mjs', import.meta.url);

function runCli(directory, ...args) {
  return spawnSync(process.execPath, [cliPath.pathname, ...args, '--db', join(directory, 'db.sqlite')], {
    encoding: 'utf8',
  });
}

test('CLI creates a project, appends a record and exports its handover', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-cli-test-'));
  try {
    const created = runCli(directory, 'project', 'create', '--name', 'CLI project', '--purpose', 'Exercise the interface');
    assert.equal(created.status, 0, created.stderr);
    const project = JSON.parse(created.stdout);
    assert.equal(project.name, 'CLI project');

    const projects = runCli(directory, 'project', 'list');
    assert.equal(projects.status, 0, projects.stderr);
    assert.deepEqual(JSON.parse(projects.stdout).map((item) => item.id), [project.id]);

    const added = runCli(
      directory, 'record', 'add',
      '--project', project.id,
      '--category', 'decision',
      '--origin', 'user',
      '--content', 'Keep the history append-only.',
    );
    assert.equal(added.status, 0, added.stderr);
    const record = JSON.parse(added.stdout);
    assert.equal(record.projectId, project.id);
    assert.equal(record.content, 'Keep the history append-only.');

    const listed = runCli(directory, 'record', 'list', '--project', project.id);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).map((item) => item.id), [record.id]);

    const handover = runCli(directory, 'handover', '--project', project.id);
    assert.equal(handover.status, 0, handover.stderr);
    const exported = JSON.parse(handover.stdout);
    assert.equal(exported.project.id, project.id);
    assert.equal(exported.recordCountKnown, 1);
    assert.equal(exported.records[0].id, record.id);
    assert.equal(exported.completeness, 'recorded_context_only');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI reports missing required options without crashing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'devbridge-cli-error-'));
  try {
    const result = runCli(directory, 'project', 'create');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing required option --name/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
