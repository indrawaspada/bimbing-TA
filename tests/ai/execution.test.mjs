// Real PostgreSQL WASM migrations/locks/ACL; mock Auth/provider, NOT hosted concurrency.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, rest } from "../workspace/sql-adapter.mjs";
import { signJwt } from "../security/harness.mjs";
import { execute, makeHandler } from "../../supabase/functions/ai/service.ts";
const q = (s, p) => db.query(s, p);
const owner = randomUUID(),
  A = randomUUID(),
  B = randomUUID();
let project, other, version, model, request;
const result = () => ({
  summary: "Draf bab pertama",
  answer: "OK",
  limitations: [],
  findings: [
    {
      rule_id: "B1-R01",
      title: "Konteks kurang lengkap",
      severity: "Major",
      confidence: "high",
      rule_status: "Fail",
      evidence_type: "quote",
      pdf_page: 1,
      quote: "Problem nyata dan terukur.",
      reason: "Konteks perlu diperjelas.",
      recommendation: "Lengkapi konteks.",
      acceptance_criterion: "Konteks mencakup pihak dan batas penelitian.",
    },
  ],
  ratings: [
    {
      id: "argumentasi",
      status: "Assessed",
      rating: 2,
      reason: "Perlu perbaikan",
    },
  ],
  traceability: [],
});
const provider = (data = result()) =>
  new Response(
    JSON.stringify({
      id: "mock-response",
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(data) }] },
      ],
      usage: { input_tokens: 1000, output_tokens: 300 },
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "mock-request",
      },
    },
  );
const env = (k) =>
  ({
    OPENAI_API_KEY: "synthetic-only-key",
    ALLOWED_ORIGINS: "https://app.example",
  })[k];
// Minimal database adapter with actual SQL, mirroring only the Supabase query methods used by the service.
class Query {
  constructor(table) {
    this.table = table;
    this.where = [];
    this.values = [];
    this.ordering = "";
    this.count = 1000;
    this.single = false;
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.values.push(v);
    this.where.push(`${k}=$${this.values.length}`);
    return this;
  }
  gte(k, v) {
    this.values.push(v);
    this.where.push(`${k}>=$${this.values.length}`);
    return this;
  }
  lte(k, v) {
    this.values.push(v);
    this.where.push(`${k}<=$${this.values.length}`);
    return this;
  }
  order(k, opt) {
    this.ordering = ` order by ${k} ${opt?.ascending === false ? "desc" : "asc"}`;
    return this;
  }
  limit(n) {
    this.count = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  async then(resolve, reject) {
    try {
      const rows = (
        await q(
          `select * from public.${this.table}${this.where.length ? " where " + this.where.join(" and ") : ""}${this.ordering} limit ${this.count}`,
          this.values,
        )
      ).rows;
      return resolve({
        data: this.single ? rows[0] || null : rows,
        error: null,
      });
    } catch (error) {
      return resolve({ data: null, error });
    }
  }
}
const database = {
  from: (t) => new Query(t),
  rpc: async (name, args) => {
    try {
      const entries = Object.entries(args);
      const r = await q(
        `select to_jsonb(public.${name}(${entries.map(([k], i) => `${k}:=$${i + 1}`).join(",")})) as result`,
        entries.map(([, v]) => v),
      );
      return { data: r.rows[0].result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
const userRest = (id, method, path, body) =>
  rest(signJwt({ sub: id }), method, path, body);
after(async () => {
  await db.close();
});
test("D fixture: nine migrations, active owner/two students, sealed version, explicit consent, configured disabled-by-default ledger", async () => {
  for (const [id, email] of [
    [owner, "owner.ai@example.test"],
    [A, "a.ai@example.test"],
    [B, "b.ai@example.test"],
  ])
    await q(
      "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)",
      [id, email, { provider: "google", providers: ["google"] }],
    );
  await q("select public.bootstrap_owner('owner.ai@example.test')");
  for (const [id, email] of [
    [A, "a.ai@example.test"],
    [B, "b.ai@example.test"],
  ])
    await q(
      "insert into memberships(auth_user_id,verified_email,role) values($1,$2,'student')",
      [id, email],
    );
  project = (
    await q(
      "insert into projects(title,research_profile,stage,owner_uid,student_uid) values('Sintetis A','ml','proposal',$1,$2) returning id",
      [owner, A],
    )
  ).rows[0].id;
  other = (
    await q(
      "insert into projects(title,research_profile,stage,owner_uid,student_uid) values('Sintetis B','ml','proposal',$1,$2) returning id",
      [owner, B],
    )
  ).rows[0].id;
  version = (
    await q(
      "insert into versions(project_id,file_name,file_size,status,page_count,file_hash,extraction_hash) values($1,'synthetic.pdf',1000,'extracted',2,$2,$3) returning id",
      [project, "a".repeat(64), "b".repeat(64)],
    )
  ).rows[0].id;
  for (let n = 1; n <= 2; n++)
    await q(
      "insert into pages(version_id,pdf_page,text,text_hash) values($1,$2,$3,$4)",
      [
        version,
        n,
        n === 1 ? "Problem nyata dan terukur." : "Bagian di luar scope.",
        "c".repeat(64),
      ],
    );
  await q(
    "insert into chapter_ranges(version_id,chapter,start_page,end_page,confirmed) values($1,'B1',1,2,true)",
    [version],
  );
  await q("update versions set status='confirmed' where id=$1", [version]);
  for (const id of [owner, A])
    await q(
      "insert into ai_consents(project_id,user_id,allowed_data,provider_terms_ack) values($1,$2,$3,true)",
      [project, id, { providers: ["openai"], chapter_text: true, chat: true }],
    );
  model = (
    await q(
      "insert into model_settings(provider,model_id,capability,input_usd_per_million,output_usd_per_million,roles_allowed) values('openai','synthetic-model',$1,2,10,$2) returning *",
      [{ structured_output: true }, ["owner", "student"]],
    )
  ).rows[0];
  assert.equal(model.enabled, false);
  await q(
    "update model_settings set last_test_status='ok',last_tested_hash=config_hash,enabled=true where id=$1",
    [model.id],
  );
  model = (await q("select * from model_settings where id=$1", [model.id]))
    .rows[0];
  await q(
    "insert into budget_settings(month,ai_enabled,student_ai_enabled,max_cost_usd,per_call_max_usd,max_calls,per_student_calls) values(to_char(now() at time zone 'UTC','YYYY-MM'),true,true,5,0.25,40,5)",
  );
  await q("update projects set student_uid=$1 where id=$2", [A, project]);
  await q("update projects set student_uid=$1 where id=$2", [B, other]);
  request = {
    action: "preview",
    operation: "review",
    project_id: project,
    version_id: version,
    chapter: "B1",
    start_page: 1,
    end_page: 1,
    model_setting_id: model.id,
  };
});
test("D unauthorized project/spoofed role/proxy request stops before provider call", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return provider();
  };
  await assert.rejects(
    execute(
      { ...request, role: "owner", url: "https://evil.example" },
      B,
      database,
      env,
      fetcher,
    ),
    /not_authorized/,
  );
  assert.equal(calls, 0);
  const r = await userRest(A, "POST", "/rpc/ai_claim", {
    p_requester: owner,
    p_project: project,
    p_version: version,
    p_model: model.id,
    p_operation: "review",
    p_chapter: "B1",
    p_scope: {},
    p_key: randomUUID(),
    p_cache: "fake",
    p_hashes: {},
  });
  assert.ok(r.status >= 400);
});
let completed;
test("D double submit: one live-mocked call, one reservation, draft findings, accepted dimensions only", async () => {
  const preview = await execute(request, owner, database, env);
  assert.equal(preview.scope.start_page, 1);
  assert.ok(!preview.request.includes("Bagian di luar scope."));
  let calls = 0,
    release;
  const gate = new Promise((ok) => {
    release = ok;
  });
  const fetcher = async () => {
    calls++;
    await gate;
    return provider();
  };
  const runInput = {
    ...request,
    action: "run",
    preview_hash: preview.cache_key,
    idempotency_key: randomUUID(),
  };
  const first = execute(runInput, owner, database, env, fetcher);
  // Await an observable claim, rather than arbitrary delays.
  for (let i = 0; i < 100; i++) {
    const rows = (
      await q("select id from ai_runs where idempotency_key=$1", [
        runInput.idempotency_key,
      ])
    ).rows;
    if (rows.length) break;
    await new Promise((ok) => setImmediate(ok));
  }
  const second = await execute(runInput, owner, database, env, fetcher);
  assert.equal(second.run.state, "running");
  release();
  completed = (await first).run;
  assert.equal(calls, 1);
  assert.equal(completed.state, "succeeded");
  assert.equal(
    (
      await q("select * from usage_reservations where run_id=$1", [
        completed.id,
      ])
    ).rows.length,
    1,
  );
  const f = (await q("select * from findings where run_id=$1", [completed.id]))
    .rows[0];
  assert.equal(f.approval_state, "draft");
  assert.equal(f.workflow_status, null);
  assert.equal(f.quote_validation, "verified");
  const rt = (
    await q("select * from ai_rating_reviews where run_id=$1", [completed.id])
  ).rows[0];
  assert.equal(rt.approval_state, "draft");
  assert.equal(rt.dimensions.length, 4);
  assert.equal(rt.approved_dimensions, null);
});
test("D cache reuse is isolated by requester and context; no fresh reservation or provider call", async () => {
  const preview = await execute(request, owner, database, env);
  let calls = 0;
  const out = await execute(
    {
      ...request,
      action: "run",
      preview_hash: preview.cache_key,
      idempotency_key: randomUUID(),
    },
    owner,
    database,
    env,
    async () => {
      calls++;
      return provider();
    },
  );
  assert.equal(out.cached, true);
  assert.equal(out.run.cached_from, completed.id);
  assert.equal(calls, 0);
  assert.equal(
    (await q("select id from usage_reservations where run_id=$1", [out.run.id]))
      .rows.length,
    0,
  );
  const studentPreview = await execute(request, A, database, env);
  assert.notEqual(studentPreview.cache_key, preview.cache_key);
  const hidden = await userRest(A, "GET", `/ai_runs?id=eq.${completed.id}`);
  assert.deepEqual(hidden.json, []);
});
test("D only owner may accept AI findings/ratings; approval opens revision, preserves original and records audit", async () => {
  const f = (await q("select * from findings where run_id=$1", [completed.id]))
    .rows[0];
  const fail = await userRest(A, "POST", "/rpc/finding_decide", {
    p_finding: f.id,
    p_expected: f.row_version,
    p_accept: true,
    p_reason: "",
  });
  assert.ok(fail.status >= 400);
  const success = await userRest(owner, "POST", "/rpc/finding_decide", {
    p_finding: f.id,
    p_expected: f.row_version,
    p_accept: true,
    p_reason: "",
  });
  assert.equal(
    success.json[0]?.workflow_status || success.json.workflow_status,
    "open",
  );
  const now = (await q("select * from findings where id=$1", [f.id])).rows[0];
  assert.deepEqual(now.original_ai, f.original_ai);
  assert.ok(
    (
      await q(
        "select * from audit_events where entity_id=$1 and action='ai_finding_decision'",
        [f.id],
      )
    ).rows.length,
  );
  const rt = (
    await q("select * from ai_rating_reviews where run_id=$1", [completed.id])
  ).rows[0];
  const bad = await userRest(owner, "POST", "/rpc/rating_decide", {
    p_rating: rt.id,
    p_expected: rt.row_version,
    p_dimensions: rt.dimensions.map((d, i) => ({
      ...d,
      weight: i ? d.weight : 1000,
    })),
    p_accept: true,
  });
  assert.ok(bad.status >= 400);
  const ok = await userRest(owner, "POST", "/rpc/rating_decide", {
    p_rating: rt.id,
    p_expected: rt.row_version,
    p_dimensions: rt.dimensions,
    p_accept: true,
  });
  assert.equal(ok.status, 200);
});
test("D monthly cap is reserved before dispatch; ambiguous run retains liability", async () => {
  const month = new Date().toISOString().slice(0, 7);
  await q("update budget_settings set max_cost_usd=0.079 where month=$1", [
    month,
  ]);
  const changed = { ...request, start_page: 2, end_page: 2 };
  const preview = await execute(changed, owner, database, env);
  let calls = 0;
  await assert.rejects(
    execute(
      {
        ...changed,
        action: "run",
        preview_hash: preview.cache_key,
        idempotency_key: randomUUID(),
      },
      owner,
      database,
      env,
      async () => {
        calls++;
        return provider();
      },
    ),
    /budget_exceeded/,
  );
  assert.equal(calls, 0);
  await q("update budget_settings set max_cost_usd=5 where month=$1", [month]);
  const out = await execute(
    {
      ...changed,
      action: "run",
      preview_hash: preview.cache_key,
      idempotency_key: randomUUID(),
    },
    owner,
    database,
    env,
    async () => {
      calls++;
      throw new Error("ambiguous network");
    },
  );
  assert.equal(out.run.state, "unknown");
  const reservation = (
    await q("select * from usage_reservations where run_id=$1", [out.run.id])
  ).rows[0];
  assert.equal(reservation.status, "unknown");
  assert.equal(reservation.actual_cost, null);
  assert.ok(Number(reservation.max_cost) > 0);
});
test("D invalid JSON settles known usage without findings; config edit disables previous live test and consent revocation denies call", async () => {
  const changed = { ...request, start_page: 1, end_page: 2 };
  const preview = await execute(changed, A, database, env);
  const out = await execute(
    {
      ...changed,
      action: "run",
      preview_hash: preview.cache_key,
      idempotency_key: randomUUID(),
    },
    A,
    database,
    env,
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          output: [{ content: [{ type: "output_text", text: "invalid" }] }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      ),
  );
  assert.equal(out.run.state, "failed");
  assert.equal(out.run.error_code, "invalid_json");
  assert.equal(
    (await q("select * from usage_reservations where run_id=$1", [out.run.id]))
      .rows[0].status,
    "reconciled",
  );
  assert.equal(
    (await q("select * from findings where run_id=$1", [out.run.id])).rows
      .length,
    0,
  );
  await q(
    "update ai_consents set revoked_at=now() where project_id=$1 and user_id=$2",
    [project, A],
  );
  await assert.rejects(execute(changed, A, database, env), /consent_required/);
  const res = await userRest(
    owner,
    "PATCH",
    `/model_settings?id=eq.${model.id}`,
    { input_usd_per_million: 3 },
  );
  assert.ok(res.status < 400);
  const m = (await q("select * from model_settings where id=$1", [model.id]))
    .rows[0];
  assert.equal(m.enabled, false);
  assert.equal(m.last_tested_hash, null);
  await assert.rejects(
    execute(request, owner, database, env),
    /model_not_allowed/,
  );
});
