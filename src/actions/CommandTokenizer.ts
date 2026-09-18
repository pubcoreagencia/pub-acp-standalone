/**
 * Safe, robust command-line tokenizer.
 * Splits a command string into [executable, ...args] respecting quotes and escapes without invoking a shell.
 */
export class CommandTokenizer {
  static tokenize(cmd: string): { executable: string; args: string[]; error?: string } {
    if (!cmd || typeof cmd !== 'string') {
      return { executable: '', args: [], error: 'Command must be a non-empty string' };
    }

    const trimmed = cmd.trim();
    if (!trimmed) {
      return { executable: '', args: [], error: 'Command cannot be blank' };
    }

    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (escape) {
        current += char;
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"' || char === "'") {
          inQuotes = true;
          quoteChar = char;
        } else if (char === ' ' || char === '\t') {
          if (current.length > 0) {
            tokens.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }

    if (inQuotes) {
      return { executable: '', args: [], error: `Unterminated quote in command: "${cmd}"` };
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    if (tokens.length === 0) {
      return { executable: '', args: [], error: 'No tokens found in command' };
    }

    const executable = tokens[0];
    const args = tokens.slice(1);

    return { executable, args };
  }
}
