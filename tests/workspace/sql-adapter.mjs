// TEST ONLY. Execute SQL in real PostgreSQL WASM, sequentially, with real SET LOCAL
// ROLE/RLS/grants/triggers/RPCs. HTTP status mapping is simulated, NOT PostgREST
// or a hosted Storage/Auth validation. Native REST tests remain separately runnable.
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
export const db = await PGlite.create();
await db.exec(
  await readFile("supabase/tests/local/00_supabase_shim.sql", "utf8"),
);
for (const f of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(
    "begin;" +
      (await readFile(`supabase/migrations/${f}`, "utf8")) +
      ";commit;",
  );
await db.exec(
  execFileSync(process.execPath, ["scripts/seed-rubric.mjs"], {
    encoding: "utf8",
  }),
);
export const pool = {
  query: async (q, p) => {
    const r = await db.query(q, p);
    return { ...r, rowCount: r.rows.length || r.affectedRows || 0 };
  },
  end: async () => {
    if (!db.closed) await db.close();
  },
  connect: async () => ({ query: pool.query, release() {} }),
};
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error("bad identifier");
  return '"' + s + '"';
};
export async function rest(
  token,
  method,
  path,
  body,
  prefer = "return=representation",
) {
  let claims = {};
  if (token)
    claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
  const role = token ? "authenticated" : "anon";
  let params = [];
  const param = (v) => {
    params.push(v);
    return "$" + params.length;
  };
  try {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ ...claims, role }),
    ]);
    await db.exec("set local role " + role);
    const url = new URL("http://test" + path);
    const table = url.pathname.split("/").at(-1);
    let rows, status;
    if (url.pathname.startsWith("/rpc/")) {
      const entries = Object.entries(body || {});
      const args = entries
        .map(([k, v]) => `${ident(k)} := ${param(v)}`)
        .join(",");
      const type = (
        await db.query(
          "select t.typname from pg_proc p join pg_type t on t.oid=p.prorettype where p.proname=$1 and p.pronamespace='public'::regnamespace",
          [table],
        )
      ).rows[0]?.typname;
      const call = `public.${ident(table)}(${args})`;
      const result = await db.query(
        `select ${type === "void" ? call : `to_jsonb(${call})`} result`,
        params,
      );
      rows = result.rows[0]?.result ?? null;
      if (["versions", "findings"].includes(type)) rows = [rows];
      status = type === "void" ? 204 : 200;
    } else {
      const conditions = [];
      let select = "*";
      for (const [key, value] of url.searchParams) {
        if (key === "select") {
          select =
            value === "*"
              ? "*"
              : value
                  .split(",")
                  .map((s) => ident(s.trim()))
                  .join(",");
          continue;
        }
        if (["order", "limit", "offset"].includes(key)) continue;
        const dot = value.indexOf(".");
        const op = value.slice(0, dot),
          v = value.slice(dot + 1);
        if (op === "neq") conditions.push(`${ident(key)} <> ${param(v)}`);
        else if (op === "not" && v === "is.null")
          conditions.push(`${ident(key)} is not null`);
        else if (op === "eq") conditions.push(`${ident(key)} = ${param(v)}`);
        else if (op === "is")
          conditions.push(
            `${ident(key)} is ${v === "null" ? "null" : v === "true" ? "true" : "false"}`,
          );
        else throw new Error("unsupported filter " + value);
      }
      const where = conditions.length
        ? " where " + conditions.join(" and ")
        : "";
      if (method === "GET")
        rows = (
          await db.query(
            `select ${select} from public.${ident(table)}${where}`,
            params,
          )
        ).rows;
      else if (method === "POST") {
        rows = [];
        for (const item of Array.isArray(body) ? body : [body]) {
          params = [];
          const entries = Object.entries(item);
          const cols = entries.map(([k]) => ident(k)).join(",");
          const vals = entries.map(([, v]) => param(v)).join(",");
          rows.push(
            ...(
              await db.query(
                `insert into public.${ident(table)}(${cols}) values(${vals}) returning *`,
                params,
              )
            ).rows,
          );
        }
      } else if (method === "PATCH") {
        const set = Object.entries(body)
          .map(([k, v]) => `${ident(k)} = ${param(v)}`)
          .join(",");
        rows = (
          await db.query(
            `update public.${ident(table)} set ${set}${where} returning *`,
            params,
          )
        ).rows;
      } else if (method === "DELETE")
        rows = (
          await db.query(
            `delete from public.${ident(table)}${where} returning *`,
            params,
          )
        ).rows;
      else throw new Error("unsupported method");
      status = method === "POST" ? 201 : 200;
    }
    await db.exec("commit");
    return { status, json: rows };
  } catch (e) {
    await db.exec("rollback");
    return {
      status:
        e.code === "42501"
          ? token
            ? 403
            : 401
          : e.code === "PT409"
            ? 409
            : 400,
      json: { code: e.code, message: e.message },
    };
  }
}
