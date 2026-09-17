import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { AgConversationSummary, IAntigravitySessionStore } from './types.js';

/**
 * Normalizes an arbitrary filesystem path into a canonical Antigravity URI format.
 * Preserved for compatibility with existing tests and callers.
 */
export function normalizeWorkspacePathToUri(rawPath: string): string {
  if (!rawPath || typeof rawPath !== 'string') {
    throw new Error('Invalid workspace path: path must be a non-empty string');
  }

  const resolved = resolve(rawPath);
  const url = pathToFileURL(resolved);
  let href = url.href;

  // On Windows, Node's pathToFileURL produces "file:///C:/...".
  // Antigravity IDE encodes the colon as "%3A" and lowercases the drive letter: "file:///c%3A/..."
  href = href.replace(/^file:\/\/\/([a-zA-Z]):\//, (_, drive) => {
    return `file:///${drive.toLowerCase()}%3A/`;
  });

  // Ensure trailing slashes are stripped for consistent prefix/exact matching
  return href.replace(/\/+$/, '');
}

/**
 * Converts either a file:// URI or a raw filesystem path into a canonical,
 * resolved, lowercase filesystem path representation.
 * Handles both file:///C:/... (CLI) and file:///c%3A/... (IDE).
 */
export function canonicalizeWorkspacePath(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('file://')) {
      const parsedPath = fileURLToPath(trimmed);
      return resolve(parsedPath).toLowerCase();
    }
    return resolve(trimmed).toLowerCase();
  } catch {
    return null;
  }
}

export interface AntigravitySessionStoreOptions {
  /**
   * Single database path (legacy/test support).
   */
  dbPath?: string;
  /**
   * Multiple database paths in priority order (e.g. [cliDbPath, ideDbPath]).
   */
  dbPaths?: string[];
}

/**
 * Read-only adapter for Antigravity's internal conversation storage.
 * Supports querying both Antigravity CLI (~/.gemini/antigravity-cli/)
 * and Antigravity IDE (~/.gemini/antigravity/) databases without cross-contamination.
 */
export class AntigravitySessionStore implements IAntigravitySessionStore {
  private readonly dbPaths: string[];

  constructor(options: AntigravitySessionStoreOptions = {}) {
    if (options.dbPaths && options.dbPaths.length > 0) {
      this.dbPaths = [...options.dbPaths];
    } else if (options.dbPath) {
      this.dbPaths = [options.dbPath];
    } else {
      const userHome = homedir();
      this.dbPaths = [
        // Priority 1: CLI sessions
        join(userHome, '.gemini', 'antigravity-cli', 'conversation_summaries.db'),
        // Priority 2: IDE sessions
        join(userHome, '.gemini', 'antigravity', 'conversation_summaries.db')
      ];
    }
  }

  /**
   * Returns list of configured database paths.
   */
  getDbPaths(): string[] {
    return [...this.dbPaths];
  }

  private openDbs(): DatabaseSync[] {
    const dbs: DatabaseSync[] = [];
    const missing: string[] = [];

    for (const p of this.dbPaths) {
      if (!existsSync(p)) {
        missing.push(p);
        continue;
      }
      try {
        dbs.push(new DatabaseSync(p, { readOnly: true }));
      } catch (err: any) {
        // Close any already opened before failing
        for (const openDb of dbs) {
          try { openDb.close(); } catch {}
        }
        throw new Error(`Failed to open Antigravity database '${p}' in read-only mode: ${err.message}`);
      }
    }

    if (dbs.length === 0) {
      throw new Error(`Antigravity conversation database not found at '${this.dbPaths.join("', '")}'`);
    }

    return dbs;
  }

  async listConversationsForWorkspace(workspacePath: string): Promise<AgConversationSummary[]> {
    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      throw new Error('Invalid workspace path: must provide a non-empty string');
    }

    const canonicalTarget = canonicalizeWorkspacePath(workspacePath);
    if (!canonicalTarget) {
      throw new Error(`Invalid workspace path: '${workspacePath}'`);
    }

    const dbs = this.openDbs();
    try {
      const seen = new Set<string>();
      const matching: AgConversationSummary[] = [];

      for (const db of dbs) {
        const stmt = db.prepare(`
          SELECT 
            conversation_id,
            title,
            preview,
            status,
            last_modified_time,
            step_count,
            workspace_uris
          FROM conversation_summaries
          ORDER BY last_modified_time DESC
        `);

        const rows = stmt.all() as Array<{
          conversation_id: string;
          title: string;
          preview: string;
          status: string;
          last_modified_time: string;
          step_count: number;
          workspace_uris: string;
        }>;

        for (const row of rows) {
          const convId = row.conversation_id?.trim();
          if (!convId || seen.has(convId)) continue;

          if (this.urisMatchWorkspace(row.workspace_uris, canonicalTarget)) {
            seen.add(convId);
            matching.push({
              conversationId: convId,
              title: row.title || 'Conversa sem título',
              preview: row.preview || '',
              status: row.status || 'UNKNOWN',
              lastModifiedTime: row.last_modified_time,
              stepCount: row.step_count || 0
            });
          }
        }
      }

      // Sort combined results DESC by lastModifiedTime
      matching.sort((a, b) => new Date(b.lastModifiedTime).getTime() - new Date(a.lastModifiedTime).getTime());
      return matching;
    } catch (err: any) {
      throw new Error(`Error querying conversations for workspace: ${err.message}`);
    } finally {
      for (const db of dbs) {
        try { db.close(); } catch {}
      }
    }
  }

  async getConversation(conversationId: string): Promise<AgConversationSummary | null> {
    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      throw new Error('Invalid conversation ID: must provide a non-empty string');
    }

    const trimmedId = conversationId.trim();
    const dbs = this.openDbs();

    try {
      for (const db of dbs) {
        const stmt = db.prepare(`
          SELECT 
            conversation_id,
            title,
            preview,
            status,
            last_modified_time,
            step_count
          FROM conversation_summaries
          WHERE conversation_id = ?
          LIMIT 1
        `);

        const row = stmt.get(trimmedId) as {
          conversation_id: string;
          title: string;
          preview: string;
          status: string;
          last_modified_time: string;
          step_count: number;
        } | undefined;

        if (row) {
          return {
            conversationId: row.conversation_id,
            title: row.title || 'Conversa sem título',
            preview: row.preview || '',
            status: row.status || 'UNKNOWN',
            lastModifiedTime: row.last_modified_time,
            stepCount: row.step_count || 0
          };
        }
      }

      return null;
    } catch (err: any) {
      throw new Error(`Error fetching conversation '${conversationId}': ${err.message}`);
    } finally {
      for (const db of dbs) {
        try { db.close(); } catch {}
      }
    }
  }

  async belongsToWorkspace(conversationId: string, workspacePath: string): Promise<boolean> {
    if (!conversationId || typeof conversationId !== 'string' || !conversationId.trim()) {
      return false;
    }
    if (!workspacePath || typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return false;
    }

    const canonicalTarget = canonicalizeWorkspacePath(workspacePath);
    if (!canonicalTarget) {
      return false;
    }

    let dbs: DatabaseSync[];
    try {
      dbs = this.openDbs();
    } catch {
      return false;
    }

    const trimmedId = conversationId.trim();
    try {
      for (const db of dbs) {
        const stmt = db.prepare(`
          SELECT workspace_uris
          FROM conversation_summaries
          WHERE conversation_id = ?
          LIMIT 1
        `);

        const row = stmt.get(trimmedId) as { workspace_uris: string } | undefined;
        if (row && row.workspace_uris) {
          // If conversation found in this database, verify workspace binding
          return this.urisMatchWorkspace(row.workspace_uris, canonicalTarget);
        }
      }

      return false;
    } catch {
      return false;
    } finally {
      for (const db of dbs) {
        try { db.close(); } catch {}
      }
    }
  }

  /**
   * Decodes the stored workspace_uris JSON array and validates whether
   * any URI canonicalizes to the exact same filesystem path as canonicalTarget.
   * Enforces strict equality — no prefix matching, no traversal.
   */
  private urisMatchWorkspace(storedUrisJson: string, canonicalTarget: string): boolean {
    if (!storedUrisJson) return false;

    let parsedUris: string[];
    try {
      parsedUris = JSON.parse(storedUrisJson);
      if (!Array.isArray(parsedUris)) return false;
    } catch {
      return false;
    }

    for (const uri of parsedUris) {
      if (typeof uri !== 'string') continue;
      const canonicalStored = canonicalizeWorkspacePath(uri);
      if (canonicalStored && canonicalStored === canonicalTarget) {
        return true;
      }
    }

    return false;
  }
}
