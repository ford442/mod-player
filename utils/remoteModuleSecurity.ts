/**
 * Remote module URL sanitization and host allowlisting.
 * Blocks dangerous protocols and restricts cross-origin fetches to known hosts.
 */

const BLOCKED_PROTOCOLS = /^(?:javascript|data|vbscript|file|blob):/i;

const DEFAULT_ALLOWED_HOSTS = [
  'storage.noahcohn.com',
  'wasm.noahcohn.com',
  'modarchive.org',
  'api.modarchive.org',
  'www.modarchive.org',
] as const;

function parseEnvAllowlist(): string[] {
  const raw = (import.meta.env.VITE_MODULE_HOST_ALLOWLIST ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((entry: string) => entry.trim().toLowerCase())
    .filter(Boolean);
}

let cachedAllowlist: Set<string> | null = null;

export function getModuleHostAllowlist(): ReadonlySet<string> {
  if (cachedAllowlist) return cachedAllowlist;
  cachedAllowlist = new Set<string>([
    ...DEFAULT_ALLOWED_HOSTS,
    ...parseEnvAllowlist(),
  ]);
  return cachedAllowlist;
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out;
}

/** Strip control chars and reject dangerous URL schemes. */
export function sanitizeRemoteUrl(raw: string): string | null {
  const trimmed = stripControlChars(raw.trim());
  if (!trimmed) return null;
  if (BLOCKED_PROTOCOLS.test(trimmed)) return null;

  try {
    const parsed = new URL(trimmed, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Reject embedded credentials
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSameOriginUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function isAllowedModuleHost(url: string): boolean {
  const sanitized = sanitizeRemoteUrl(url);
  if (!sanitized) return false;
  if (isSameOriginUrl(sanitized)) return true;

  try {
    const host = new URL(sanitized).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return true;
    return getModuleHostAllowlist().has(host);
  } catch {
    return false;
  }
}

export function assertAllowedModuleUrl(url: string): string {
  const sanitized = sanitizeRemoteUrl(url);
  if (!sanitized) {
    throw new Error('Invalid module URL');
  }
  if (!isAllowedModuleHost(sanitized)) {
    throw new Error('Module host is not on the allowlist');
  }
  return sanitized;
}
