import { AIError, resultSchema, type Model } from "./core.ts";
export function providerRequest(
  model: Model,
  system: string,
  user: string,
  key: string,
): { url: string; headers: Record<string, string>; body: Record<string, any> } {
  if (!/^[A-Za-z0-9._:-]{2,120}$/.test(model.model_id))
    throw new AIError("invalid_model_id");
  if (model.capability?.structured_output !== true)
    throw new AIError("structured_output_required");
  const limit = Math.min(4000, model.max_output_tokens);
  if (!Number.isInteger(limit) || limit < 100)
    throw new AIError("invalid_output_cap");
  const effort = model.capability?.effort;
  if (
    effort &&
    (model.provider !== "openai" ||
      !model.capability?.supported_efforts?.includes(effort))
  )
    throw new AIError("unsupported_effort");
  const thinking = model.capability?.thinking_budget;
  if (
    model.provider === "gemini" &&
    (model.capability?.supports_thinking_budget !== true ||
      !Number.isInteger(thinking) ||
      thinking < 0 ||
      thinking > limit - 100)
  )
    throw new AIError("bounded_thinking_required");
  switch (model.provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/responses",
        headers: { Authorization: `Bearer ${key}` },
        body: {
          model: model.model_id,
          store: false,
          max_output_tokens: limit,
          instructions: system,
          input: user,
          ...(effort ? { reasoning: { effort } } : {}),
          text: {
            format: {
              type: "json_schema",
              name: "thesis_review",
              strict: true,
              schema: resultSchema,
            },
          },
        },
      };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: {
          model: model.model_id,
          max_tokens: limit,
          system,
          messages: [{ role: "user", content: user }],
          output_config: {
            format: { type: "json_schema", schema: resultSchema },
          },
        },
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.model_id)}:generateContent`,
        headers: { "x-goog-api-key": key },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: limit - thinking,
            thinkingConfig: {
              thinkingBudget: thinking,
              includeThoughts: false,
            },
            responseMimeType: "application/json",
            responseJsonSchema: resultSchema,
          },
        },
      };
    default:
      throw new AIError("provider_not_allowed");
  }
}
export function normalize(
  provider: string,
  data: any,
  requestId: string | null,
) {
  let text = "",
    input: any = null,
    output: any = null,
    reasoning: any = 0,
    refusal = false,
    incomplete = false;
  if (provider === "openai") {
    const parts = (data.output || []).flatMap((o: any) => o.content || []);
    text = parts
      .filter((p: any) => p.type === "output_text")
      .map((p: any) => p.text)
      .join("");
    refusal = parts.some((p: any) => p.type === "refusal");
    incomplete = data.status !== "completed";
    input = data.usage?.input_tokens;
    output = data.usage?.output_tokens;
    reasoning = data.usage?.output_tokens_details?.reasoning_tokens || 0;
  } else if (provider === "anthropic") {
    text = (data.content || [])
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
    refusal = data.stop_reason === "refusal";
    incomplete = data.stop_reason !== "end_turn";
    if (Number.isFinite(data.usage?.input_tokens))
      input =
        data.usage.input_tokens +
        (data.usage.cache_creation_input_tokens || 0) +
        (data.usage.cache_read_input_tokens || 0);
    output = data.usage?.output_tokens;
  } else {
    const c = data.candidates?.[0];
    text = (c?.content?.parts || [])
      .filter((p: any) => !p.thought && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("");
    refusal =
      !!data.promptFeedback?.blockReason ||
      ["SAFETY", "RECITATION", "PROHIBITED_CONTENT"].includes(c?.finishReason);
    incomplete = c?.finishReason !== "STOP";
    input = data.usageMetadata?.promptTokenCount;
    reasoning = data.usageMetadata?.thoughtsTokenCount || 0;
    if (Number.isFinite(data.usageMetadata?.candidatesTokenCount))
      output = data.usageMetadata.candidatesTokenCount + reasoning;
  }
  const usage =
    Number.isSafeInteger(input) &&
    input >= 0 &&
    Number.isSafeInteger(output) &&
    output >= 0
      ? {
          input_tokens: input,
          output_tokens: output,
          reasoning_tokens: reasoning,
        }
      : null;
  if (refusal || incomplete || !text)
    throw new AIError(
      refusal ? "provider_refusal" : "provider_incomplete",
      true,
      usage,
    );
  return {
    text,
    usage,
    request_id: requestId || data.id || data.responseId || null,
  };
}
export async function callProvider(
  model: Model,
  system: string,
  user: string,
  key: string,
  timeoutMs = 100000,
  fetcher: typeof fetch = fetch,
) {
  const request = providerRequest(model, system, user, key);
  try {
    const res = await fetcher(request.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(100000, Math.max(1000, timeoutMs))),
      headers: { "Content-Type": "application/json", ...request.headers },
      body: JSON.stringify(request.body),
    });
    if (!res.ok)
      throw new AIError(
        res.status === 429
          ? "provider_rate_limit"
          : res.status === 401 || res.status === 403
            ? "provider_key_rejected"
            : "provider_http_error",
        true,
      );
    return normalize(
      model.provider,
      await res.json(),
      res.headers.get("x-request-id"),
    );
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError("provider_timeout_or_network", true);
  }
}
