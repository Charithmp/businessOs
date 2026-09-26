const SECRET = /\b(password|passphrase|secret|token|authorization|api[_-]?key|card|cvv|bearer)\b|\b(?:\d[ -]*?){13,19}\b|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)\+?\d[\d ()-]{8,}\d(?!\d)/g;

export function safeText(value: string | null | undefined): string | null {
  if (!value) return null;
  if (SECRET.test(value)) return '[REDACTED]';
  return value.slice(0,500).replace(EMAIL,'[EMAIL]').replace(PHONE,'[PHONE]');
}
