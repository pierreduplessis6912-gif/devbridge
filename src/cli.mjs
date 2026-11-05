import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openStore } from './store.mjs';

const HELP = `DevBridge local continuity CLI

Usage:
  node src/cli.mjs project create --name "Project name" [--purpose "..."] [--db PATH]
  node src/cli.mjs project list [--db PATH]
  node src/cli.mjs record add --project ID --category CATEGORY --origin user|ai|connected_source --content "..." [--label "..."] [--db PATH]
  node src/cli.mjs record list --project ID [--limit N] [--db PATH]
  node src/cli.mjs handover --project ID [--limit N] [--db PATH]

The default database is .devbridge/devbridge.sqlite in the current directory.
All output is JSON. Records are appended; this interface does not edit history.
`;

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!key || Object.hasOwn(options, key)) throw new Error(`Invalid or repeated option: ${token}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[key] = value;
    i += 1;
  }
  return options;
}

function required(options, key) {
  const value = options[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required option --${key}`);
  }
  return value.trim();
}

function positiveLimit(value, fallback = 50) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error('--limit must be a positive safe integer');
  }
  return Number(value);
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(args) {
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    process.stdout.write(HELP);
    return;
  }

  const command = args[0];
  const subcommand = command === 'handover' ? undefined : args[1];
  const optionArgs = command === 'handover' ? args.slice(1) : args.slice(2);
  const options = parseOptions(optionArgs);
  const databasePath = resolve(options.db ?? '.devbridge/devbridge.sqlite');
  mkdirSync(dirname(databasePath), { recursive: true });
  const store = openStore(databasePath);

  try {
    if (command === 'project' && subcommand === 'create') {
      output(store.createProject({
        name: required(options, 'name'),
        purpose: options.purpose,
      }));
      return;
    }
    if (command === 'project' && subcommand === 'list' && Object.keys(options).every((key) => key === 'db')) {
      output(store.listProjects());
      return;
    }
    if (command === 'record' && subcommand === 'add') {
      output(store.appendRecord({
        projectId: required(options, 'project'),
        category: required(options, 'category'),
        originType: required(options, 'origin'),
        content: required(options, 'content'),
        originLabel: options.label,
        sourceRef: options['source-ref'],
        statusText: options.status,
      }));
      return;
    }
    if (command === 'record' && subcommand === 'list') {
      output(store.listRecords(required(options, 'project'), {
        limit: positiveLimit(options.limit, 100),
      }));
      return;
    }
    if (command === 'handover') {
      if (subcommand !== undefined) throw new Error('handover does not take a subcommand');
      output(store.buildHandover(required(options, 'project'), {
        recordLimit: positiveLimit(options.limit),
      }));
      return;
    }
    throw new Error(`Unknown command: ${args.slice(0, 2).join(' ')}\nRun with "help" to see usage.`);
  } finally {
    store.close();
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`DevBridge: ${error.message}\n`);
  process.exitCode = 1;
}
