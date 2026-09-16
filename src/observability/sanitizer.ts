const SENSITIVE_PATTERNS = [
  /bearer\s+[a-zA-Z0-9_\-\.]+/gi,
  /ghp_[a-zA-Z0-9]{30,}/g,
  /github_pat_[a-zA-Z0-9_\-]{30,}/g,
  /sk-[a-zA-Z0-9]{20,}/g,
  /AIza[0-9A-Za-z-_]{35}/g,
  /"?(?:password|token|secret|apiKey|api_key|access_token|authorization|cookie|private_key)"?\s*[:=]\s*"?([^",\s\}]+)"?/gi
];

export function sanitizeText(text: string): string {
  if (!text) return text;
  let sanitized = text;
  
  // Replace auth headers and common bearer patterns
  sanitized = sanitized.replace(/bearer\s+[a-zA-Z0-9_\-\.]+/gi, 'Bearer [REDACTED]');
  
  // Replace explicit keys
  sanitized = sanitized.replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_[REDACTED]');
  sanitized = sanitized.replace(/github_pat_[a-zA-Z0-9_\-]+/g, 'github_pat_[REDACTED]');
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, 'sk-[REDACTED]');
  sanitized = sanitized.replace(/AIza[0-9A-Za-z-_]{35}/g, 'AIza[REDACTED]');

  // Key-value pairs
  sanitized = sanitized.replace(
    /((?:password|token|secret|apiKey|api_key|access_token|authorization|cookie|private_key)\s*:\s*)([^]+)()/gi,
 '[REDACTED]'
 );

 return sanitized;
}

export function sanitizeObject<T>(obj: T, seen = new WeakSet()): T {
 if (obj === null || typeof obj !== 'object') {
 if (typeof obj === 'string') {
 return sanitizeText(obj) as unknown as T;
 }
 return obj;
 }

 if (seen.has(obj as object)) {
 return '[CIRCULAR]' as unknown as T;
 }
 seen.add(obj as object);

 if (Array.isArray(obj)) {
 return obj.map(item => sanitizeObject(item, seen)) as unknown as T;
 }

 const result: Record<string, unknown> = {};
 const sensitiveKeys = new Set([
 'password',
 'token',
 'secret',
 'apikey',
 'api_key',
 'access_token',
 'authorization',
 'cookie',
 'privatekey',
 'private_key',
 'credentials'
 ]);

 for (const [key, value] of Object.entries(obj)) {
 if (sensitiveKeys.has(key.toLowerCase())) {
 result[key] = '[REDACTED]';
 } else {
 result[key] = sanitizeObject(value, seen);
 }
 }

 return result as T;
}
