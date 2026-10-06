// TEST HARNESS ONLY: serves a harness build (dist-harness) and proxies /rest/v1 -> local PostgREST,
// so the real UI can be exercised against the real migrations/RLS with SYNTHETIC personas.
// Auth is emulated by injecting a locally signed session (no Google, no real users).
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import pg from 'pg';
import { signJwt } from '../tests/security/harness.mjs';

const PORT = Number(process.env.HARNESS_PORT || 54330);
const REST = process.env.TEST_REST_URL || 'http://127.0.0.1:54321';
const ROOT = new URL('../dist-harness/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

const db = new pg.Client({ connectionString: 'postgres://postgres:postgres_local_only@127.0.0.1:5432/bimbingta_test' });
await db.connect();
const { rows } = await db.query(`select m.auth_user_id id, m.verified_email email, m.role, m.display_name from memberships m order by role, verified_email`);
const sessions = {};
for (const r of rows) {
  const exp = Math.floor(Date.now() / 1000) + 6 * 3600;
  const access_token = signJwt({ sub: r.id, email: r.email, exp });
  sessions[r.email] = { access_token, refresh_token: 'harness', token_type: 'bearer', expires_in: 21600, expires_at: exp,
    user: { id: r.id, email: r.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: { full_name: r.display_name } } };
}
await writeFile('/tmp/harness_sessions.json', JSON.stringify(sessions));
await db.end();

http.createServer(async (req, res) => {
  if (req.url.startsWith('/rest/v1/')) {
    const body = await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
    const headers = { ...req.headers }; delete headers.host; delete headers['content-length'];
    const r = await fetch(REST + req.url.slice('/rest/v1'.length), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const path = req.url.split('?')[0];
  const file = path === '/' || !extname(path) ? 'index.html' : path;
  try { const f = await readFile(join(ROOT, file)); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(f); }
  catch { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(join(ROOT, 'index.html'))); }
}).listen(PORT, () => console.log(`ui harness on http://127.0.0.1:${PORT} (sessions in /tmp/harness_sessions.json)`));
