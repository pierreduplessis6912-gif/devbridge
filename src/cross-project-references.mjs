import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(field + ' must be a non-empty string');
  }
  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new TypeError(field + ' must be a string');
  return value.trim() || null;
}

/**
 * Explicit Cross-Project references.
 *
 * A reference stores only the source/target Project identities and the
 * user-supplied label. It does not load target Project records, build a
 * target handover, create an activation, deliver context or grant access.
 *
 * This module is a data-separation boundary, not an authorization system.
 * Callers must enforce their own authenticated access policy before allowing
 * a user to create or inspect references.
 */
export function openCrossProjectReferences(databasePath) {
  if (typeof databasePath !== 'string' || databasePath.trim().length === 0) {
    throw new TypeError('databasePath must be a non-empty string');
  }

  const db = new DatabaseSync(databasePath.trim());
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_project_references (
      id TEXT PRIMARY KEY,
      source_project_id TEXT NOT NULL REFERENCES projects(id),
      target_project_id TEXT NOT NULL REFERENCES projects(id),
      label TEXT,
      created_at TEXT NOT NULL,
      CHECK (source_project_id <> target_project_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS cross_project_references_source
      ON cross_project_references(source_project_id, created_at, id);

    CREATE TRIGGER IF NOT EXISTS cross_project_references_no_update
      BEFORE UPDATE ON cross_project_references
      BEGIN SELECT RAISE(ABORT, 'Cross-Project references are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS cross_project_references_no_delete
      BEFORE DELETE ON cross_project_references
      BEGIN SELECT RAISE(ABORT, 'Cross-Project references are append-only'); END;
  `);

  let closed = false;
  const ensureOpen = () => {
    if (closed) throw new Error('Cross-Project reference store is closed');
  };

  return {
    createCrossProjectReference({
      id = randomUUID(),
      sourceProjectId,
      targetProjectId,
      label = null,
      createdAt = new Date().toISOString(),
    }) {
      ensureOpen();
      const referenceId = requiredText(id, 'id');
      const source = requiredText(sourceProjectId, 'sourceProjectId');
      const target = requiredText(targetProjectId, 'targetProjectId');
      const description = optionalText(label, 'label');
      const timestamp = requiredText(createdAt, 'createdAt');

      if (source === target) {
        throw new Error('A Project cannot reference itself as another Project');
      }

      db.prepare(`
        INSERT INTO cross_project_references
          (id, source_project_id, target_project_id, label, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(referenceId, source, target, description, timestamp);

      return this.getCrossProjectReference(referenceId);
    },

    getCrossProjectReference(referenceId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, source_project_id AS sourceProjectId,
          target_project_id AS targetProjectId, label, created_at AS createdAt
        FROM cross_project_references
        WHERE id = ?
      `).get(requiredText(referenceId, 'referenceId')) ?? null;
    },

    listCrossProjectReferences(sourceProjectId) {
      ensureOpen();
      return db.prepare(`
        SELECT id, source_project_id AS sourceProjectId,
          target_project_id AS targetProjectId, label, created_at AS createdAt
        FROM cross_project_references
        WHERE source_project_id = ?
        ORDER BY created_at, id
      `).all(requiredText(sourceProjectId, 'sourceProjectId'));
    },

    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
}
