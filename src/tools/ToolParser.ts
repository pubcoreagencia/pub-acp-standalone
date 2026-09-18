import { ToolRequest } from './types.js';

interface IndexedDirective {
  index: number;
  request: ToolRequest;
}

export class ToolParser {
  private static readonly TOOL_REGEX = /\[TOOL:\s*([a-zA-Z0-9_\-]+)\.([a-zA-Z0-9_\-]+)\]([\s\S]*?)\[\/TOOL\]/g;
  private static readonly LEGACY_EXEC_REGEX = /\[EXEC:\s*([\s\S]*?)\]\s*\[\/EXEC\]/g;
  private static readonly LEGACY_FILE_CREATE_REGEX = /\[FILE_CREATE:\s*([^\n\r\]]+)\]([\s\S]*?)\[\/FILE_CREATE\]/g;
  private static readonly LEGACY_FILE_WRITE_REGEX = /\[FILE_WRITE:\s*([^\n\r\]]+)\]([\s\S]*?)\[\/FILE_WRITE\]/g;
  private static readonly LEGACY_FILE_READ_REGEX = /\[FILE_READ:\s*([^\n\r\]]+)\]\s*\[\/FILE_READ\]/g;
  private static readonly LEGACY_FILE_DELETE_REGEX = /\[FILE_DELETE:\s*([^\n\r\]]+)\]\s*\[\/FILE_DELETE\]/g;

  static parse(text: string): ToolRequest[] {
    if (!text || typeof text !== 'string') return [];

    const indexedDirectives: IndexedDirective[] = [];

    // 1. Semantic [TOOL: tool.operation] ... [/TOOL]
    const toolMatches = [...text.matchAll(ToolParser.TOOL_REGEX)];
    for (const match of toolMatches) {
      const tool = match[1].toLowerCase().trim();
      const operation = match[2].toLowerCase().trim();
      const body = match[3].trim();

      const args: Record<string, unknown> = {};
      if (body) {
        if (body.startsWith('{') && body.endsWith('}')) {
          try {
            const parsedJson = JSON.parse(body);
            Object.assign(args, parsedJson);
          } catch {
            // fallback
          }
        }
        if (Object.keys(args).length === 0) {
          const contentIdx = body.indexOf('content=');
          if (contentIdx !== -1) {
            const beforeContent = body.substring(0, contentIdx);
            const contentVal = body.substring(contentIdx + 'content='.length);
            args['content'] = contentVal.trim();

            const lines = beforeContent.split(/\r?\n/);
            for (const line of lines) {
              const eqIdx = line.indexOf('=');
              if (eqIdx !== -1) {
                const k = line.substring(0, eqIdx).trim();
                const v = line.substring(eqIdx + 1).trim();
                if (k) args[k] = v;
              }
            }
          } else {
            const lines = body.split(/\r?\n/);
            for (const line of lines) {
              const eqIdx = line.indexOf('=');
              if (eqIdx !== -1) {
                const k = line.substring(0, eqIdx).trim();
                const v = line.substring(eqIdx + 1).trim();
                if (k) args[k] = v;
              } else if (line.trim()) {
                args['input'] = line.trim();
              }
            }
          }
        }
      }

      indexedDirectives.push({
        index: match.index ?? 0,
        request: {
          tool,
          operation,
          args,
          rawDirective: match[0],
          legacyExec: false
        }
      });
    }

    // 2. Legacy Bridge: [EXEC: ...] -> ToolRequest
    const execMatches = [...text.matchAll(ToolParser.LEGACY_EXEC_REGEX)];
    for (const match of execMatches) {
      const cmd = match[1].trim();
      if (cmd) {
        if (cmd.startsWith('git status')) {
          indexedDirectives.push({
            index: match.index ?? 0,
            request: {
              tool: 'git',
              operation: 'status',
              args: {},
              rawDirective: match[0],
              legacyExec: true
            }
          });
        } else if (cmd.startsWith('npm test')) {
          indexedDirectives.push({
            index: match.index ?? 0,
            request: {
              tool: 'npm',
              operation: 'test',
              args: {},
              rawDirective: match[0],
              legacyExec: true
            }
          });
        } else {
          indexedDirectives.push({
            index: match.index ?? 0,
            request: {
              tool: 'process',
              operation: 'exec',
              args: { command: cmd },
              rawDirective: match[0],
              legacyExec: true
            }
          });
        }
      }
    }

    // 3. Legacy Bridge: [FILE_CREATE], [FILE_WRITE], [FILE_READ], [FILE_DELETE] -> WorkspaceTool
    const createMatches = [...text.matchAll(ToolParser.LEGACY_FILE_CREATE_REGEX)];
    for (const match of createMatches) {
      indexedDirectives.push({
        index: match.index ?? 0,
        request: {
          tool: 'workspace',
          operation: 'create',
          args: { path: match[1].trim(), content: match[2] },
          rawDirective: match[0],
          legacyExec: false
        }
      });
    }

    const writeMatches = [...text.matchAll(ToolParser.LEGACY_FILE_WRITE_REGEX)];
    for (const match of writeMatches) {
      indexedDirectives.push({
        index: match.index ?? 0,
        request: {
          tool: 'workspace',
          operation: 'write',
          args: { path: match[1].trim(), content: match[2] },
          rawDirective: match[0],
          legacyExec: false
        }
      });
    }

    const readMatches = [...text.matchAll(ToolParser.LEGACY_FILE_READ_REGEX)];
    for (const match of readMatches) {
      indexedDirectives.push({
        index: match.index ?? 0,
        request: {
          tool: 'workspace',
          operation: 'read',
          args: { path: match[1].trim() },
          rawDirective: match[0],
          legacyExec: false
        }
      });
    }

    const delMatches = [...text.matchAll(ToolParser.LEGACY_FILE_DELETE_REGEX)];
    for (const match of delMatches) {
      indexedDirectives.push({
        index: match.index ?? 0,
        request: {
          tool: 'workspace',
          operation: 'delete',
          args: { path: match[1].trim() },
          rawDirective: match[0],
          legacyExec: false
        }
      });
    }

    // Stable sort strictly according to occurrence position in text
    indexedDirectives.sort((a, b) => a.index - b.index);

    return indexedDirectives.map(d => d.request);
  }
}
