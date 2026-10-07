// TEST HARNESS ONLY — helpers for security tests. Synthetic personas, no real student data.
// Local mode (default): PostgREST + PostgreSQL emulating Supabase (scripts/local-test-db.sh).
import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';

export const REST = process.env.TEST_REST_URL || `http://127.0.0.1:${process.env.PGRST_PORT || 54321}`;
const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'local-test-secret-not-for-production-000000';
export const DB_URL = process.env.TEST_DB_URL || 'postgres://postgres:postgres_local_only@127.0.0.1:5432/bimbingta_test';

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export function signJwt(claims) {
  const head = b64u({ alg: 'HS256', typ: 'JWT' });
  const body = b64u({ aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

const adapter=process.env.TEST_SQL_WASM==='1'?await import('../workspace/sql-adapter.mjs'):null;
export async function rest(token, method, path, body, prefer = 'return=representation') {
  if(adapter)return adapter.rest(token,method,path,body,prefer);
  const headers = { 'Content-Type': 'application/json', Prefer: prefer };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${REST}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

export const pool = adapter?.pool || new pg.Pool({ connectionString: DB_URL, max: 4 });
export const sql = (q, p) => pool.query(q, p);

// Run SQL as an API role with JWT claims (emulates Supabase Storage API executing under the caller's RLS)
export async function asUser(persona, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: persona.id, role: 'authenticated' })]);
    await c.query('set local role authenticated');
    const out = await fn(c);
    await c.query('commit');
    return { ok: true, out };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e };
  } finally { c.release(); }
}

export function persona(email, { provider = 'google', confirmed = true, userMeta = {}, appMeta } = {}) {
  const id = randomUUID();
  return {
    id, email, provider, confirmed,
    userMeta, appMeta: appMeta || { provider, providers: [provider] },
    get token() { return signJwt({ sub: id, email, user_metadata: this.userMeta, app_metadata: this.appMeta }); },
  };
}

// Equivalent of a Google OAuth sign-in landing a row in auth.users (done by Supabase Auth in production)
export async function createAuthUser(p) {
  await sql(`insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
             values ($1, $2, $3, $4, $5)`, [p.id, p.email, p.confirmed ? new Date() : null, p.appMeta, p.userMeta]);
}

