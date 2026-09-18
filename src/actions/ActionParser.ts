import { ActionDirective } from './types.js';

export class ActionParser {
  /**
   * Parses action directives from raw model text.
   * Supported blocks:
   * [FILE_CREATE: path]content[/FILE_CREATE]
   * [FILE_WRITE: path]content[/FILE_WRITE]
   * [FILE_READ: path][/FILE_READ] or [FILE_READ: path]
   * [FILE_DELETE: path][/FILE_DELETE] or [FILE_DELETE: path]
   * [EXEC: command][/EXEC] or [EXEC]command[/EXEC]
   */
  static parse(rawText: string): ActionDirective[] {
    const actions: ActionDirective[] = [];
    if (!rawText || typeof rawText !== 'string') return actions;

    // Pattern for content-bearing directives: FILE_CREATE, FILE_WRITE
    const contentRegex = /\[(FILE_CREATE|FILE_WRITE):\s*([^\]]+)\]([\s\S]*?)\[\/\1\]/gi;
    let match: RegExpExecArray | null;

    // Find all matches with their indices to preserve document order if mixed
    interface IndexedAction {
      index: number;
      action: ActionDirective;
    }
    const matchedItems: IndexedAction[] = [];

    while ((match = contentRegex.exec(rawText)) !== null) {
      const type = match[1].toUpperCase() as 'FILE_CREATE' | 'FILE_WRITE';
      const path = match[2].trim();
      const content = match[3];
      matchedItems.push({
        index: match.index,
        action: { type, path, content }
      });
    }

    // Pattern for FILE_READ: [FILE_READ: path][/FILE_READ] or [FILE_READ: path]
    const readRegex = /\[FILE_READ:\s*([^\]]+)\](?:\[\/FILE_READ\])?/gi;
    while ((match = readRegex.exec(rawText)) !== null) {
      const path = match[1].trim();
      matchedItems.push({
        index: match.index,
        action: { type: 'FILE_READ', path }
      });
    }

    // Pattern for FILE_DELETE: [FILE_DELETE: path][/FILE_DELETE] or [FILE_DELETE: path]
    const deleteRegex = /\[FILE_DELETE:\s*([^\]]+)\](?:\[\/FILE_DELETE\])?/gi;
    while ((match = deleteRegex.exec(rawText)) !== null) {
      const path = match[1].trim();
      matchedItems.push({
        index: match.index,
        action: { type: 'FILE_DELETE', path }
      });
    }

    // Pattern for EXEC:
    // Format A: [EXEC: command][/EXEC] or [EXEC: command]
    // Format B: [EXEC]command[/EXEC]
    const execWithArgRegex = /\[EXEC:\s*([^\]]+)\](?:\[\/EXEC\])?/gi;
    while ((match = execWithArgRegex.exec(rawText)) !== null) {
      const command = match[1].trim();
      matchedItems.push({
        index: match.index,
        action: { type: 'EXEC', command }
      });
    }

    const execBlockRegex = /\[EXEC\]([\s\S]*?)\[\/EXEC\]/gi;
    while ((match = execBlockRegex.exec(rawText)) !== null) {
      const command = match[1].trim();
      matchedItems.push({
        index: match.index,
        action: { type: 'EXEC', command }
      });
    }

    // Sort by original index in the text to execute deterministically in declared order
    matchedItems.sort((a, b) => a.index - b.index);

    return matchedItems.map(item => item.action);
  }
}
