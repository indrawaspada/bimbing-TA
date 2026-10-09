import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { workspace, CHAPTERS, download, type Row } from "@/lib/workspace";
import { supabase, must } from "@/lib/supabase";
import { invokeAI, aiMessage } from "@/lib/ai";
import { calculateChapter } from "@/lib/score/score_reference";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import masterPrompt from "../../../data/master_prompt.txt?raw";
export default function AITab({ project }: { project: any }) {
  const { session, isOwner } = useAuth();
  const uid = session?.user.id;
  const [versions, setVersions] = useState<Row[]>([]),
    [models, setModels] = useState<Row[]>([]),
    [runs, setRuns] = useState<Row[]>([]),
    [ratings, setRatings] = useState<Row[]>([]),
    [consent, setConsent] = useState<Row | null>(null),
    [findings, setFindings] = useState<Row[]>([]);
  const [version, setVersion] = useState(""),
    [chapter, setChapter] = useState("B1"),
    [start, setStart] = useState(1),
    [end, setEnd] = useState(1),
    [model, setModel] = useState(""),
    [operation, setOperation] = useState("review"),
    [question, setQuestion] = useState(""),
    [excerpt, setExcerpt] = useState(""),
    [excerptPage, setExcerptPage] = useState(1),
    [review, setReview] = useState("");
  const [allowed, setAllowed] = useState<string[]>([]),
    [allowChat, setAllowChat] = useState(false),
    [ack, setAck] = useState(false),
    [err, setErr] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<any>(null);
  const generation = useRef(0);
  const load = useCallback(async () => {
    try {
      const [v, m, r, f, rt, c] = await Promise.all([
        workspace.rows("versions", project.id),
        must(supabase.from("model_settings").select("*")),
        workspace.rows("ai_runs", project.id),
        workspace.rows("findings", project.id),
        workspace.rows("ai_rating_reviews", project.id),
        must(
          supabase
            .from("ai_consents")
            .select("*")
            .eq("project_id", project.id)
            .eq("user_id", uid)
            .maybeSingle(),
        ),
      ]);
      setVersions(v.filter((x) => x.status === "confirmed"));
      setModels(m || []);
      setRuns(r);
      setFindings(f.filter((x) => x.source === "ai"));
      setRatings(rt);
      setConsent(c);
      if (c) {
        setAllowed(c.allowed_data?.providers || []);
        setAllowChat(!!c.allowed_data?.chat);
        setAck(c.provider_terms_ack && !c.revoked_at);
      }
    } catch (e: any) {
      setErr(e.message);
    }
  }, [project.id, uid]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    generation.current++;
    setPreview(null);
  }, [
    version,
    chapter,
    start,
    end,
    model,
    operation,
    question,
    excerpt,
    excerptPage,
    review,
  ]);
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    workspace
      .ranges(version)
      .then((rows) => {
        if (!cancelled) {
          const r = rows.find((x) => x.chapter === chapter && x.confirmed);
          if (r) {
            setStart(r.start_page);
            setEnd(r.end_page);
            setExcerptPage(r.start_page);
          }
        }
      })
      .catch((e) => setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [version, chapter]);
  const action = async (fn: () => Promise<any>) => {
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const input = () => ({
    project_id: project.id,
    version_id: version,
    chapter,
    start_page: start,
    end_page: end,
    model_setting_id: model,
    operation,
    ...(operation === "chat"
      ? {
          question,
          excerpt: excerpt ? { pdf_page: excerptPage, text: excerpt } : null,
          review_id: review || null,
        }
      : {}),
  });
  const activeModels = models.filter(
    (m) => m.enabled && m.roles_allowed.includes(isOwner ? "owner" : "student"),
  );
  return (
    <div className="space-y-4">
      <Alert>
        AI menghasilkan draf dari teks terpilih. Diagram dan indeks sumber belum
        diverifikasi. Semua alur bimbingan manual tetap tersedia.
      </Alert>
      {err && <Alert tone="error">{err}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">Persetujuan pemrosesan eksternal</h2>
        <p className="text-sm">
          Pilih provider yang boleh menerima teks halaman/kutipan dari proyek
          ini. File PDF, catatan privat, identitas dan diskusi bimbingan tidak
          dikirim. Dialog hanya menyertakan maksimum delapan pesan AI sebelumnya
          dalam lingkup yang sama. Kebijakan data bergantung provider dan paket
          akun; free tier dapat memiliki ketentuan penggunaan data berbeda.
        </p>
        <div className="flex flex-wrap gap-4">
          {["openai", "anthropic", "gemini"].map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allowed.includes(p)}
                onChange={(e) =>
                  setAllowed(
                    e.target.checked
                      ? [...allowed, p]
                      : allowed.filter((x) => x !== p),
                  )
                }
              />
              {p}
            </label>
          ))}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={allowChat}
            onChange={(e) => setAllowChat(e.target.checked)}
          />
          Izinkan pertanyaan dan riwayat dialog AI terbatas dikirim
        </label>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
          />
          Saya memahami dan menyetujui pengiriman teks yang dipilih ke provider
          yang dicentang.
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={busy}
            disabled={!ack || !allowed.length}
            onClick={() =>
              action(async () => {
                const values = {
                  allowed_data: {
                    providers: allowed,
                    chapter_text: true,
                    chat: allowChat,
                  },
                  provider_terms_ack: true,
                };
                if (consent)
                  await workspace.update("ai_consents", consent, {
                    ...values,
                    revoked_at: null,
                  });
                else
                  await workspace.insert("ai_consents", {
                    ...values,
                    project_id: project.id,
                  });
                setNotice("Persetujuan tersimpan untuk proyek ini.");
              })
            }
          >
            Simpan persetujuan proyek
          </Button>
          {consent && !consent.revoked_at && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() =>
                action(async () => {
                  await workspace.update("ai_consents", consent, {
                    revoked_at: new Date().toISOString(),
                  });
                  setAck(false);
                  setPreview(null);
                  setNotice(
                    "Persetujuan dicabut untuk permintaan berikutnya. Data yang sudah dikirim tidak dapat ditarik dari provider.",
                  );
                })
              }
            >
              Cabut persetujuan
            </Button>
          )}
        </div>
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">Review dan dialog berdasarkan lingkup</h2>
        {!versions.length && (
          <Empty title="Belum ada naskah terkunci">
            Unggah, ekstrak dan konfirmasi naskah pada tab Naskah.
          </Empty>
        )}
        {!activeModels.length && (
          <Alert tone="warn">
            Belum ada model AI aktif yang diizinkan. Pembimbing dapat
            mengaturnya di Pengaturan. Ekspor prompt manual tetap tersedia.
          </Alert>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Versi terkunci">
            <Select
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">Pilih versi</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.sequence} · {v.file_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bab">
            <Select
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
            >
              {CHAPTERS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="PDF halaman awal">
            <Input
              type="number"
              min={1}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            />
          </Field>
          <Field label="PDF halaman akhir">
            <Input
              type="number"
              min={start}
              value={end}
              onChange={(e) => setEnd(Number(e.target.value))}
            />
          </Field>
          <Field label="Operasi">
            <Select
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              <option value="review">Review bab</option>
              <option value="chat">Dialog kutipan / review</option>
              <option value="traceability">Saran keterlacakan</option>
            </Select>
          </Field>
          <Field label="Provider / model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Pilih model</option>
              {activeModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.provider} · {m.label || m.model_id} · {m.tier}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {operation === "chat" && (
          <>
            <Field label="Review sendiri untuk konteks dialog (opsional jika kutipan diisi)">
              <Select
                value={review}
                onChange={(e) => setReview(e.target.value)}
              >
                <option value="">Gunakan kutipan</option>
                {runs
                  .filter(
                    (r) =>
                      r.requester_uid === uid &&
                      r.version_id === version &&
                      r.chapter === chapter &&
                      r.operation === "review" &&
                      r.state === "succeeded",
                  )
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {fmtDate(r.created_at)} · PDF {r.scope.start_page}–
                      {r.scope.end_page}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Halaman PDF kutipan">
              <Input
                type="number"
                value={excerptPage}
                min={start}
                max={end}
                onChange={(e) => setExcerptPage(Number(e.target.value))}
              />
            </Field>
            <Field label="Kutipan persis dari teks halaman (opsional jika review dipilih)">
              <Textarea
                maxLength={8000}
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
              />
            </Field>
            <Field label="Pertanyaan">
              <Textarea
                maxLength={4000}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </Field>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={busy}
            disabled={
              !version || !model || !ack || !consent || !!consent.revoked_at
            }
            onClick={() =>
              action(async () => {
                const request = input();
                const gen = generation.current;
                const result = await invokeAI({
                  ...request,
                  action: "preview",
                });
                if (gen === generation.current)
                  setPreview({
                    ...result,
                    requestInput: request,
                    idempotency_key: crypto.randomUUID(),
                  });
              })
            }
          >
            Periksa data dan estimasi
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            disabled={!version}
            onClick={() =>
              action(async () => {
                const [pages, rubric, ranges] = await Promise.all([
                  workspace.pages(version),
                  must(
                    supabase
                      .from("rubric_versions")
                      .select("*")
                      .eq("is_active", true)
                      .single(),
                  ),
                  workspace.ranges(version),
                ]);
                const range = ranges.find(
                  (r) => r.chapter === chapter && r.confirmed,
                );
                if (
                  !range ||
                  start < range.start_page ||
                  end > range.end_page ||
                  end < start
                )
                  throw new Error(
                    "Pilih halaman di dalam rentang bab terkunci.",
                  );
                download(
                  `prompt-${chapter}-${start}-${end}.txt`,
                  masterPrompt +
                    "\nMODE: teks saja. Semua hasil adalah draf.\n" +
                    JSON.stringify(
                      {
                        chapter,
                        profile: project.research_profile,
                        stage: project.stage,
                        pages: pages
                          .filter(
                            (p) => p.pdf_page >= start && p.pdf_page <= end,
                          )
                          .map((p) => ({ pdf_page: p.pdf_page, text: p.text })),
                        rules: rubric.content_json.rules.filter(
                          (r: any) => r.chapter === chapter,
                        ),
                      },
                      null,
                      2,
                    ),
                );
                setNotice(
                  "Prompt diunduh untuk dipakai manual; periksa kebijakan layanan tujuan sebelum mengirim.",
                );
              })
            }
          >
            Ekspor prompt manual
          </Button>
        </div>
        {preview && (
          <div className="space-y-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
            <p className="text-sm">
              Lingkup PDF {preview.scope.start_page}–{preview.scope.end_page} ·{" "}
              {preview.input_token_upper_bound} batas atas token input ·
              reservasi maksimum USD{" "}
              {Number(preview.max_reserved_usd).toFixed(4)} ·{" "}
              {preview.history_messages} pesan terdahulu. Halaman di luar
              lingkup tidak diperiksa.
            </p>
            <p className="text-sm">{preview.missing_context.join(" ")}</p>
            <details>
              <summary className="cursor-pointer text-sm font-semibold">
                Lihat teks dan konteks yang akan dikirim
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">
                {preview.request}
              </pre>
            </details>
            <Button
              loading={busy}
              onClick={() =>
                action(async () => {
                  const out = await invokeAI({
                    ...preview.requestInput,
                    action: "run",
                    preview_hash: preview.cache_key,
                    idempotency_key: preview.idempotency_key,
                  });
                  setNotice(
                    out.run.state === "succeeded"
                      ? out.cached
                        ? "Hasil cache digunakan; tidak ada panggilan provider baru."
                        : "Draf hasil tersimpan."
                      : aiMessage(out.run.error_code || out.run.state),
                  );
                  setPreview(null);
                })
              }
            >
              Kirim lingkup ini ke provider
            </Button>
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Riwayat AI</h2>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Muat ulang status
          </Button>
        </div>
        {!runs.length && <p className="text-sm">Belum ada permintaan AI.</p>}
        {runs.map((r) => (
          <div
            key={r.id}
            className="space-y-2 rounded-lg border border-ink-100 p-3"
          >
            <p className="text-sm font-semibold">
              {r.operation} · {r.chapter || "Uji"} · {r.model_id}
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge>{r.state}</Badge>
              {r.cached_from && (
                <Badge tone="teal">Cache · biaya baru USD 0</Badge>
              )}
            </div>
            <p className="text-xs">
              {fmtDate(r.created_at)} · PDF {r.scope.start_page || "—"}–
              {r.scope.end_page || "—"}
              {r.usage?.input_tokens !== undefined
                ? ` · token ${r.usage.input_tokens}/${r.usage.output_tokens}`
                : " · penggunaan belum pasti"}
            </p>
            {r.error_code && (
              <Alert tone="warn">{aiMessage(r.error_code)}</Alert>
            )}
            {r.normalized_result && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  Lihat hasil draf
                </summary>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {r.normalized_result.summary}
                </p>
                <p className="whitespace-pre-wrap text-sm">
                  {r.normalized_result.answer}
                </p>
                <ul className="mt-2 list-disc pl-5 text-xs">
                  {r.normalized_result.limitations?.map(
                    (l: string, i: number) => (
                      <li key={i}>{l}</li>
                    ),
                  )}
                </ul>
                {r.validation?.rule_statuses?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {r.validation.rule_statuses.map((s: any) => (
                      <Badge key={s.rule_id}>
                        {s.rule_id}: {s.status}
                      </Badge>
                    ))}
                  </div>
                )}
                {r.normalized_result.traceability?.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm">
                      Saran keterlacakan dari lingkup ini saja. Salin dan
                      periksa pada tab Keterlacakan.
                    </p>
                    <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(
                        r.normalized_result.traceability,
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                )}
              </details>
            )}
          </div>
        ))}
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">Temuan draf dan keputusan pembimbing</h2>
        {!findings.length && (
          <p className="text-sm">
            Belum ada temuan AI. Temuan yang diterima akan muncul sebagai revisi
            terbuka.
          </p>
        )}
        {findings.map((f) => (
          <DraftFinding
            key={`${f.id}:${f.row_version}`}
            row={f}
            owner={isOwner}
            reload={load}
          />
        ))}
      </Card>
      <Card className="space-y-3 p-4">
        <h2 className="font-bold">Penilaian dimensi</h2>
        <p className="text-sm">
          Skor hanya dihitung dari penilaian yang diterima pembimbing; cakupan
          ditampilkan terpisah.
        </p>
        {ratings.map((r) => (
          <Rating
            key={`${r.id}:${r.row_version}`}
            row={r}
            owner={isOwner}
            reload={load}
          />
        ))}
      </Card>
    </div>
  );
}
function DraftFinding({
  row,
  owner,
  reload,
}: {
  row: Row;
  owner: boolean;
  reload: () => Promise<void>;
}) {
  const [values, setValues] = useState({
    title: row.title,
    reason: row.reason,
    recommendation: row.recommendation,
    acceptance_criterion: row.acceptance_criterion,
    quote: row.quote || "",
  });
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState(false),
    [reason, setReason] = useState("");
  const act = async (fn: () => Promise<any>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      await reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-ink-100 p-3">
      <div className="flex flex-wrap gap-2">
        <Badge>{row.approval_state}</Badge>
        <Badge tone={row.severity === "Critical" ? "red" : "amber"}>
          {row.severity}
        </Badge>
        <Badge>{row.quote_validation}</Badge>
      </div>
      <h3 className="font-semibold">
        {row.rule_id} · {row.title}
      </h3>
      <p className="text-xs">
        PDF {row.locator?.pdf_page || "lingkup diperiksa"} · {row.confidence}
      </p>
      {row.quote && (
        <blockquote className="border-l-2 border-ink-200 pl-3 text-sm">
          {row.quote}
        </blockquote>
      )}
      <p className="whitespace-pre-wrap text-sm">{row.reason}</p>
      <p className="text-sm">
        <strong>Saran:</strong> {row.recommendation}
      </p>
      <p className="text-sm">
        <strong>Kriteria:</strong> {row.acceptance_criterion}
      </p>
      {err && <Alert tone="error">{err}</Alert>}
      {owner && row.approval_state === "draft" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!row.original_ai?.ready_to_approve}
              loading={busy}
              onClick={() =>
                act(() =>
                  workspace.rpc("finding_decide", {
                    p_finding: row.id,
                    p_expected: row.row_version,
                    p_accept: true,
                    p_reason: "",
                  }),
                )
              }
            >
              Terima sebagai revisi
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEdit(!edit)}
            >
              Ubah draf
            </Button>
          </div>
          {!row.original_ai?.ready_to_approve && (
            <p className="text-xs text-amber-800">
              Bukti belum terverifikasi atau klaim membutuhkan inspeksi
              visual/sumber. Tidak siap diterima; buat revisi manual setelah
              pemeriksaan.
            </p>
          )}
          {edit && (
            <>
              {Object.entries(values).map(([k, v]) => (
                <Field label={k} key={k}>
                  <Textarea
                    maxLength={
                      k === "title"
                        ? 300
                        : k === "quote" || k === "acceptance_criterion"
                          ? 4000
                          : 8000
                    }
                    value={v}
                    onChange={(e) =>
                      setValues({ ...values, [k]: e.target.value })
                    }
                  />
                </Field>
              ))}
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  act(() => workspace.update("findings", row, values))
                }
              >
                Simpan draf
              </Button>
            </>
          )}
          <Field label="Alasan penolakan">
            <Input
              maxLength={4000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            disabled={!reason.trim()}
            onClick={() =>
              act(() =>
                workspace.rpc("finding_decide", {
                  p_finding: row.id,
                  p_expected: row.row_version,
                  p_accept: false,
                  p_reason: reason,
                }),
              )
            }
          >
            Tolak dengan alasan
          </Button>
        </>
      )}
    </div>
  );
}
function Rating({
  row,
  owner,
  reload,
}: {
  row: Row;
  owner: boolean;
  reload: () => Promise<void>;
}) {
  const [dimensions, setDimensions] = useState<any[]>(row.dimensions),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const accepted =
    row.approval_state === "accepted"
      ? calculateChapter(row.approved_dimensions)
      : null;
  const decide = async (accept: boolean) => {
    setBusy(true);
    setErr("");
    try {
      await workspace.rpc("rating_decide", {
        p_rating: row.id,
        p_expected: row.row_version,
        p_dimensions: dimensions,
        p_accept: accept,
      });
      await reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-ink-100 p-3">
      <p className="font-semibold">
        {row.chapter} · {row.approval_state}
      </p>
      {accepted && (
        <p className="text-sm">
          Skor{" "}
          {accepted.score === null
            ? "Belum dinilai"
            : accepted.score.toFixed(1)}{" "}
          · cakupan {accepted.coverage?.toFixed(1) ?? "—"}% · bobot dinilai{" "}
          {accepted.assessedWeight}/{accepted.relevantWeight}.{" "}
          {accepted.incomplete ? "Cakupan belum lengkap." : ""}
        </p>
      )}
      {err && <Alert tone="error">{err}</Alert>}
      {dimensions.map((d, i) => (
        <div key={d.id} className="grid gap-2 sm:grid-cols-3">
          <p className="text-sm">
            {d.id} · bobot {d.weight}
          </p>
          <Select
            aria-label={`Status ${d.id}`}
            disabled={!owner || row.approval_state !== "draft"}
            value={d.status}
            onChange={(e) =>
              setDimensions(
                dimensions.map((x, j) =>
                  i === j
                    ? {
                        ...x,
                        status: e.target.value,
                        rating: e.target.value === "Assessed" ? 0 : null,
                      }
                    : x,
                ),
              )
            }
          >
            {["Assessed", "Not assessed", "N/A"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select
            aria-label={`Nilai ${d.id}`}
            disabled={
              !owner ||
              row.approval_state !== "draft" ||
              d.status !== "Assessed"
            }
            value={d.rating ?? ""}
            onChange={(e) =>
              setDimensions(
                dimensions.map((x, j) =>
                  i === j ? { ...x, rating: Number(e.target.value) } : x,
                ),
              )
            }
          >
            <option value="">—</option>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {owner && row.approval_state === "draft" && (
        <div className="flex gap-2">
          <Button size="sm" loading={busy} onClick={() => decide(true)}>
            Terima penilaian
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={() => decide(false)}
          >
            Tolak penilaian
          </Button>
        </div>
      )}
    </div>
  );
}
