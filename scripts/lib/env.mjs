// Shared env loader for ADMIN/TEST scripts only (never imported by the frontend bundle).
// Frontend config:  .env.local            -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (publishable)
// Admin config:     .secrets/admin.env    -> SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY (git-ignored, not read by Vite)
// Values are never printed; use describe() for safe diagnostics.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FRONTEND_ENV = join(ROOT, '.env.local');
export const ADMIN_ENV = join(ROOT, '.secrets', 'admin.env');

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const isPlaceholder = (v) => !v || /YOUR-|<|xxx|PASSWORD@/i.test(v);

/** Returns config; process.env overrides files. Throws a message listing only MISSING NAMES. */
export function loadConfig({ needAdmin = false, needDb = false } = {}) {
  const fe = parseEnvFile(FRONTEND_ENV);
  const ad = parseEnvFile(ADMIN_ENV);
  const pick = (k, src) => process.env[k] || src[k];
  const cfg = {
    url: pick('VITE_SUPABASE_URL', fe)?.replace(/\/+$/, ''),
    anonKey: pick('VITE_SUPABASE_ANON_KEY', fe),
    dbUrl: pick('SUPABASE_DB_URL', ad),
    serviceKey: pick('SUPABASE_SERVICE_ROLE_KEY', ad),
  };
  const missing = [];
  if (isPlaceholder(cfg.url)) missing.push('VITE_SUPABASE_URL (.env.local)');
  if (isPlaceholder(cfg.anonKey)) missing.push('VITE_SUPABASE_ANON_KEY (.env.local)');
  if ((needAdmin || needDb) && isPlaceholder(cfg.dbUrl)) missing.push('SUPABASE_DB_URL (.secrets/admin.env)');
  if (needAdmin && isPlaceholder(cfg.serviceKey)) missing.push('SUPABASE_SERVICE_ROLE_KEY (.secrets/admin.env)');
  if (missing.length) {
    const e = new Error(`Konfigurasi belum tersedia: ${missing.join(', ')}. Lihat docs/HOSTED_SETUP.md.`);
    e.code = 'CONFIG_MISSING';
    throw e;
  }
  return cfg;
}

/** Safe description: project ref/host only, never keys or passwords. */
export function describe(cfg) {
  const ref = (() => { try { return new URL(cfg.url).hostname.split('.')[0]; } catch { return '?'; } })();
  const dbHost = (() => { try { return new URL(cfg.dbUrl).hostname; } catch { return '?'; } })();
  return `project_ref=${ref} db_host=${dbHost}`;
}

/** Redact any configured secret values from arbitrary text before logging. */
export function redact(text, cfg) {
  let s = String(text);
  for (const v of [cfg?.anonKey, cfg?.serviceKey, cfg?.dbUrl]) if (v && v.length > 8) s = s.split(v).join('[REDACTED]');
  try { const pw = new URL(cfg?.dbUrl).password; if (pw) s = s.split(pw).join('[REDACTED]'); } catch {}
  return s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT]');
}
