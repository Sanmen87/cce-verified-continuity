// Deliberately conservative, pattern-based filtering; not a general secret detector.
const patterns = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/,
  /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"\r\n]{12,}['"]/i,
];
export function containsSecret(text: string): boolean { return patterns.some(pattern => pattern.test(text)); }
export function assertNoSecrets(text: string): void { if (containsSecret(text)) throw new Error('Potential secret rejected; content was not stored or embedded'); }
