import {
  AIError,
  buildContext,
  cost,
  hash,
  resultSchema,
  validateResult,
} from "./core.ts";
import { callProvider, providerRequest } from "./providers.ts";
const keyNames: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};
async function one(db: any, table: string, field: string, value: any) {
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq(field, value)
    .maybeSingle();
  if (error) throw new AIError("database_unavailable");
  return data;
}
async function rpc(db: any, name: string, args: any) {
  const { data, error } = await db.rpc(name, args);
  if (error)
    throw new AIError(
      error.message?.match(/^[a-z_]+$/)?.[0] || "database_operation_failed",
    );
  return data;
}
export async function execute(
  input: any,
  uid: string,
  db: any,
  env: (key: string) => string | undefined,
  fetcher: typeof fetch = fetch,
) {
  if (!input || !["status", "preview", "run", "test"].includes(input.action))
    throw new AIError("invalid_action");
  const member = await one(db, "memberships", "auth_user_id", uid);
  if (!member?.active) throw new AIError("not_authorized");
  if (input.action === "status") {
    if (member.role !== "owner") return { providers: {} };
    return {
      providers: Object.fromEntries(
        Object.entries(keyNames).map(([p, k]) => [
          p,
          {
            configured: !!env(k),
            live_tested: "Per model; see model settings",
          },
        ]),
      ),
    };
  }
  const project = await one(db, "projects", "id", input.project_id);
  if (
    !project ||
    (member.role === "owner"
      ? project.owner_uid !== uid
      : project.student_uid !== uid)
  )
    throw new AIError("not_authorized");
  const model = await one(db, "model_settings", "id", input.model_setting_id);
  const isTest = input.action === "test";
  if (
    !model ||
    (isTest
      ? member.role !== "owner"
      : !model.enabled ||
        model.last_test_status !== "ok" ||
        model.last_tested_hash !== model.config_hash ||
        !model.roles_allowed.includes(member.role))
  )
    throw new AIError("model_not_allowed");
  const key = env(keyNames[model.provider]);
  if (!key) throw new AIError("provider_not_configured");
  // No user-supplied URL, key, system prompt, raw document or role is accepted.
  let context: any,
    rubric: any,
    prompt: any,
    version: any,
    history: any[] = [],
    review: any = null;
  if (isTest) {
    context = {
      version_id: null,
      scope: { test: true },
      pages: [],
      rules: [],
      dimensions: [],
      system:
        'Return JSON only matching the supplied schema. Use summary="Connection test", answer="OK", limitations=[], findings=[], ratings=[], traceability=[].',
      user: "Connection test. No thesis or personal data.",
    };
    version = { id: null, file_hash: "test", extraction_hash: "test" };
    rubric = { source_sha256: "test" };
    prompt = { version: "connection-test-v1", source_sha256: "test" };
  } else {
    if (
      !["review", "chat", "traceability"].includes(input.operation) ||
      !/^B[1-5]$/.test(input.chapter)
    )
      throw new AIError("invalid_operation");
    version = await one(db, "versions", "id", input.version_id);
    if (
      !version ||
      version.project_id !== project.id ||
      version.status !== "confirmed"
    )
      throw new AIError("sealed_version_required");
    if (await one(db, "version_deletion_requests", "version_id", version.id))
      throw new AIError("version_deletion_pending");
    const consentRes = await db
      .from("ai_consents")
      .select("*")
      .eq("project_id", project.id)
      .eq("user_id", uid)
      .maybeSingle();
    const consent = consentRes.data;
    if (
      consentRes.error ||
      !consent ||
      consent.revoked_at ||
      !consent.provider_terms_ack ||
      !consent.allowed_data?.providers?.includes(model.provider) ||
      !consent.allowed_data?.chapter_text ||
      (input.operation === "chat" && !consent.allowed_data?.chat)
    )
      throw new AIError("consent_required");
    const { data: range, error: rangeError } = await db
      .from("chapter_ranges")
      .select("*")
      .eq("version_id", version.id)
      .eq("chapter", input.chapter)
      .maybeSingle();
    if (rangeError) throw new AIError("database_unavailable");
    rubric = await one(db, "rubric_versions", "is_active", true);
    prompt = await one(db, "prompt_versions", "is_active", true);
    if (!rubric || !prompt) throw new AIError("rubric_or_prompt_missing");
    const start = Number(input.start_page),
      end = Number(input.end_page);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end - start > 100
    )
      throw new AIError("scope_too_large");
    const { data: pages, error } = await db
      .from("pages")
      .select("pdf_page,printed_label,text")
      .eq("version_id", version.id)
      .gte("pdf_page", start)
      .lte("pdf_page", end)
      .order("pdf_page")
      .limit(102);
    if (error) throw new AIError("database_unavailable");
    if (input.operation === "chat") {
      if (input.review_id) {
        review = await one(db, "ai_runs", "id", input.review_id);
        if (
          !review ||
          review.project_id !== project.id ||
          review.requester_uid !== uid ||
          review.version_id !== version.id ||
          review.chapter !== input.chapter ||
          review.operation !== "review" ||
          review.state !== "succeeded" ||
          review.scope.start_page < start ||
          review.scope.end_page > end
        )
          throw new AIError("review_not_in_scope");
      }
      const thread = await hash({
        uid,
        project: project.id,
        version: version.id,
        chapter: input.chapter,
        start,
        end,
        excerpt: input.excerpt || null,
        review: input.review_id || null,
      });
      const messages = await db
        .from("ai_messages")
        .select("role,content")
        .eq("project_id", project.id)
        .eq("requester_uid", uid)
        .eq("thread_key", thread)
        .order("message_order", { ascending: false })
        .limit(8);
      if (messages.error) throw new AIError("database_unavailable");
      history = (messages.data || []).reverse();
      input = { ...input, thread };
    }
    context = buildContext(
      input,
      project,
      version,
      pages || [],
      range,
      rubric,
      prompt,
      history,
      review,
    );
    if (input.thread) context.scope.thread_key = input.thread;
  }
  providerRequest(model, context.system, context.user, key); // validate capability BEFORE reserving funds
  const requestBytes = new TextEncoder().encode(
    context.system + context.user + JSON.stringify(resultSchema),
  ).length;
  // Conservative byte bound (no silent clipping); rejected chunks must be narrowed explicitly.
  if (requestBytes + 1024 > Math.min(18000, model.max_input_tokens))
    throw new AIError("scope_token_limit_reduce_pages");
  const maxCost = cost(
    model,
    model.max_input_tokens,
    Math.min(4000, model.max_output_tokens),
  );
  const hashes = {
    scope: await hash(context.scope),
    rubric: await hash({
      snapshot: rubric.source_sha256,
      weights: rubric.dimension_weights,
      profile: project.research_profile,
      stage: project.stage,
    }),
    model: model.config_hash,
    prompt: prompt.version,
  };
  const cacheKey = await hash({
    uid,
    project: project.id,
    version: version.id,
    file: version.file_hash,
    text: version.extraction_hash,
    scope: hashes.scope,
    rubric: hashes.rubric,
    model: hashes.model,
    prompt: prompt.source_sha256,
    operation: isTest ? "test" : input.operation,
    question: input.question || "",
    history,
    review: review?.normalized_result || null,
  });
  if (input.action === "preview")
    return {
      scope: context.scope,
      request: context.user,
      input_token_upper_bound: requestBytes + 1024,
      max_reserved_usd: maxCost,
      missing_context: [
        "Hanya teks terpilih; gambar/diagram dan sumber eksternal tidak diperiksa.",
      ],
      history_messages: history.length,
      cache_key: cacheKey,
    };
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(input.idempotency_key || ""))
    throw new AIError("idempotency_key_required");
  if (!isTest && input.preview_hash !== cacheKey)
    throw new AIError("preview_changed_review_again");
  const claim = await rpc(db, "ai_claim", {
    p_requester: uid,
    p_project: project.id,
    p_version: version.id,
    p_model: model.id,
    p_operation: isTest ? "test" : input.operation,
    p_chapter: isTest ? null : input.chapter,
    p_scope: context.scope,
    p_key: input.idempotency_key,
    p_cache: cacheKey,
    p_hashes: hashes,
  });
  if (!claim.dispatch)
    return { run: claim.run, cached: !!claim.run.cached_from };
  let providerResult: any = null;
  try {
    providerResult = await callProvider(
      model,
      context.system,
      context.user,
      key,
      Number(env("AI_TIMEOUT_MS")) || 100000,
      fetcher,
    );
    const validated = validateResult(providerResult.text, context);
    if (
      isTest &&
      (validated.result.answer !== "OK" ||
        validated.result.findings.length ||
        validated.result.ratings.length ||
        validated.result.traceability.length)
    )
      throw new AIError("invalid_connection_test");
    if (
      input.operation === "chat" &&
      (validated.result.findings.length ||
        validated.result.ratings.length ||
        validated.result.traceability.length)
    )
      throw new AIError("chat_invalid_output");
    const ratings = context.dimensions.map((d: any) => {
      const r = validated.result.ratings.find((v: any) => v.id === d.id);
      return {
        id: d.id,
        weight: d.weight,
        status: r?.status || "Not assessed",
        rating: r?.rating ?? null,
        reason: r?.reason || "Belum dinilai",
      };
    });
    const usage = providerResult.usage;
    const run = await rpc(db, "ai_finish", {
      p_run: claim.run.id,
      p_state: "succeeded",
      p_result: validated.result,
      p_validation: validated.validation,
      p_usage: usage,
      p_actual: usage
        ? cost(model, usage.input_tokens, usage.output_tokens)
        : null,
      p_error: null,
      p_request_id: providerResult.request_id,
      p_dimensions: ratings,
      p_question: input.question || "",
    });
    return { run, cached: false };
  } catch (error) {
    const e =
      error instanceof AIError ? error : new AIError("execution_failed", true);
    const usage = providerResult?.usage || e.usage;
    try {
      const run = await rpc(db, "ai_finish", {
        p_run: claim.run.id,
        p_state: e.ambiguous ? "unknown" : "failed",
        p_result: null,
        p_validation: null,
        p_usage: usage,
        p_actual: usage
          ? cost(model, usage.input_tokens, usage.output_tokens)
          : null,
        p_error: e.code,
        p_request_id: providerResult?.request_id || null,
        p_dimensions: [],
        p_question: "",
      });
      return { run, cached: false };
    } catch {
      throw new AIError("run_unsettled_no_retry", true);
    }
  }
}
export function makeHandler(
  db: any,
  auth: any,
  env: (k: string) => string | undefined,
  fetcher: typeof fetch = fetch,
) {
  const origins = (env("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return async (req: Request) => {
    const origin = req.headers.get("Origin") || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Vary: "Origin",
      "Cache-Control": "no-store",
    };
    if (origin && !origins.includes(origin))
      return new Response(JSON.stringify({ error: "origin_not_allowed" }), {
        status: 403,
        headers,
      });
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Headers":
            "authorization, apikey, content-type, x-client-info",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    if (req.method !== "POST")
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers,
      });
    const bearer = req.headers
      .get("Authorization")
      ?.match(/^Bearer ([^\s]+)$/)?.[1];
    if (!bearer)
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers,
      });
    try {
      const { data, error } = await auth.getUser(bearer);
      if (error || !data?.user?.id || !data.user.email_confirmed_at)
        throw new AIError("unauthorized");
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > 20000)
        throw new AIError("request_too_large");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new AIError("invalid_request");
      }
      const out = await execute(body, data.user.id, db, env, fetcher);
      return new Response(JSON.stringify(out), { headers });
    } catch (error) {
      const code = error instanceof AIError ? error.code : "internal_error";
      return new Response(JSON.stringify({ error: code }), {
        status:
          code === "unauthorized" ? 401 : code === "not_authorized" ? 403 : 400,
        headers,
      });
    }
  };
}
