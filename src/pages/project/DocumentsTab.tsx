import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useAuth } from "@/lib/auth";
import { useDraft } from "@/lib/drafts";
import { openPdf, extractPdf, closePdf } from "@/lib/pdf";
import {
  workspace,
  CHAPTERS,
  STATUS,
  sha256,
  download,
  type Row,
} from "@/lib/workspace";
import { supabase, must } from "@/lib/supabase";
import { bytes, fmtDate } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  SaveIndicator,
  Spinner,
  Textarea,
} from "@/components/ui";
import Thread from "./Thread";

export default function DocumentsTab({ project }: { project: any }) {
  const [versions, setVersions] = useState<Row[]>([]),
    [selected, setSelected] = useState(""),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadDraft = useDraft(project.id, "upload:summary", { summary: "" });
  const summary = uploadDraft.value.summary;
  const load = useCallback(async () => {
    try {
      const list = await workspace.rows("versions", project.id);
      setVersions(list);
      setSelected((old) =>
        old && list.some((v) => v.id === old) ? old : list[0]?.id || "",
      );
    } catch (e: any) {
      setErr(e.message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const selectedVersion = versions.find((v) => v.id === selected);
  const upload = async (file: File, retry?: Row) => {
    setBusy(true);
    setErr("");
    setProgress("Memeriksa file dan reservasi kuota…");
    let v: Row;
    try {
      if (
        file.size > 26214400 ||
        file.size === 0 ||
        !file.name.toLowerCase().endsWith(".pdf")
      )
        throw new Error("Pilih PDF berukuran lebih dari 0 dan maksimum 25 MB.");
      if (
        retry &&
        (file.size !== Number(retry.file_size) || file.name !== retry.file_name)
      )
        throw new Error(
          "Untuk mencoba ulang, pilih file asli dengan nama dan ukuran yang sama.",
        );
      if (!retry && !(await uploadDraft.flush()))
        throw new Error("Draf ringkasan belum tersimpan.");
      const array = new Uint8Array(await file.arrayBuffer());
      if (new TextDecoder().decode(array.slice(0, 1024)).indexOf("%PDF-") < 0)
        throw new Error("Isi file tidak dikenali sebagai PDF.");
      const hash = await sha256(array);
      v = retry
        ? retry.status === "upload_failed"
          ? await workspace.rpc("version_retry_upload", {
              p_version: retry.id,
              p_expected: retry.row_version,
            })
          : retry
        : await workspace.insert("versions", {
            project_id: project.id,
            file_name: file.name,
            file_size: file.size,
            mime_type: "application/pdf",
            change_summary: summary,
          });
      setProgress("Mengunggah PDF ke penyimpanan privat…");
      const { error } = await supabase.storage
        .from("thesis-files")
        .upload(v.file_path, array, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (error) {
        // A timeout may occur after Storage committed the object. Finalize if it really exists;
        // never free its reservation just because a client request failed.
        try {
          v = await workspace.rpc("version_upload_result", {
            p_version: v.id,
            p_expected: v.row_version,
            p_hash: hash,
            p_error: error.message,
          });
        } catch {
          throw new Error(
            `Unggahan belum dapat dipastikan: ${error.message}. Muat ulang; pilih file asli untuk melanjutkan unggahan yang tertunda.`,
          );
        }
        if (v.status === "upload_failed")
          throw new Error(
            `Unggahan gagal: ${error.message}. Gunakan Coba unggah ulang.`,
          );
      } else
        v = await workspace.rpc("version_upload_result", {
          p_version: v.id,
          p_expected: v.row_version,
          p_hash: hash,
        });
      setSelected(v.id);
      await uploadDraft.reset();
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e: any) {
      setErr(e.message);
      await load();
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const used = versions
    .filter((v) => v.status !== "upload_failed")
    .reduce((n, v) => n + Number(v.file_size), 0);
  return (
    <div className="space-y-4">
      {err && (
        <Alert tone="error" onClose={() => setErr("")}>
          {err}
        </Alert>
      )}
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap justify-between gap-2">
          <h2 className="font-bold">Versi naskah PDF</h2>
          <Badge>
            {bytes(used)} / {bytes(project.storage_limit_bytes)}
          </Badge>
        </div>
        <p className="text-sm text-ink-500">
          Batas 25 MB per file, disarankan di bawah 5 MB. Versi yang
          dikonfirmasi terkunci; perbaikan diunggah sebagai versi baru. Kuota
          akhir diperiksa server.
        </p>
        <Field label="Ringkasan perubahan versi baru">
          <Textarea
            rows={2}
            maxLength={4000}
            value={summary}
            onChange={(e) => uploadDraft.setValue({ summary: e.target.value })}
            disabled={busy || !uploadDraft.ready}
          />
        </Field>
        <SaveIndicator
          state={uploadDraft.state}
          onRetry={() => void uploadDraft.flush()}
          onReload={uploadDraft.reload}
        />
        <Field label="Unggah naskah">
          <Input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy || !uploadDraft.ready}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
        </Field>
        {busy && <Spinner label={progress} />}
        <Select
          aria-label="Pilih versi naskah"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={busy}
        >
          <option value="">Pilih versi</option>
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.sequence} · {v.file_name} · {STATUS[v.status]}
            </option>
          ))}
        </Select>
      </Card>
      {selectedVersion && (
        <VersionWorkspace
          key={selectedVersion.id}
          version={selectedVersion}
          project={project}
          onChanged={async () => {
            await load();
          }}
          onRetry={(f) => upload(f, selectedVersion)}
          uploadBusy={busy}
        />
      )}
    </div>
  );
}
function VersionWorkspace({
  version,
  project,
  onChanged,
  onRetry,
  uploadBusy,
}: {
  version: Row;
  project: any;
  onChanged: () => Promise<void>;
  onRetry: (f: File) => Promise<void>;
  uploadBusy: boolean;
}) {
  const { isOwner, session } = useAuth();
  const [v, setV] = useState(version),
    [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [pages, setPages] = useState<Row[]>([]),
    [ranges, setRanges] = useState<Row[]>([]),
    [page, setPage] = useState(1),
    [err, setErr] = useState(""),
    [viewErr, setViewErr] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [fallbackCount, setFallbackCount] = useState(version.page_count || 1),
    [zoom, setZoom] = useState(1),
    [threadScope, setThreadScope] = useState("page");
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<Uint8Array | null>(null);
  const editable =
    v.status !== "confirmed" &&
    (isOwner || v.submitted_by === session?.user.id);
  useEffect(() => {
    setV(version);
  }, [version]);
  const loadText = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        workspace.pages(v.id),
        workspace.ranges(v.id),
      ]);
      setPages(p);
      setRanges(r);
    } catch (e: any) {
      setErr(e.message);
    }
  }, [v.id]);
  useEffect(() => {
    void loadText();
  }, [loadText]);
  useEffect(() => {
    let alive = true,
      doc: PDFDocumentProxy | null = null;
    if (["uploading", "upload_failed"].includes(version.status)) return;
    (async () => {
      try {
        const blob = await workspace.file(version.file_path);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        file.current = bytes;
        if (version.file_hash && (await sha256(bytes)) !== version.file_hash)
          throw new Error(
            "Hash file tidak cocok. Unduhan dihentikan; periksa file asli.",
          );
        doc = await openPdf(bytes);
        if (alive) {
          setPdf(doc);
          setFallbackCount(doc.numPages);
          setViewErr("");
        } else await closePdf(doc);
      } catch (e: any) {
        if (alive)
          setViewErr(
            `Pratinjau belum tersedia: ${e.message}. Anda dapat mengunduh file asli dan menempel teks per halaman.`,
          );
      }
    })();
    return () => {
      alive = false;
      setPdf(null);
      if (doc) void closePdf(doc);
    };
  }, [
    version.id,
    version.status === "uploading" || version.status === "upload_failed",
  ]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false,
      task: any;
    (async () => {
      try {
        const p = await pdf.getPage(page);
        if (cancelled || !canvas.current) return;
        const viewport = p.getViewport({ scale: zoom * 1.2 });
        const c = canvas.current;
        c.width = viewport.width;
        c.height = viewport.height;
        task = p.render({ canvas: c, viewport });
        await task.promise;
      } catch (e: any) {
        if (!cancelled && e.name !== "RenderingCancelledException")
          setViewErr(e.message);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom]);
  const commit = async (next: Row) => {
    setV(next);
    await loadText();
    await onChanged();
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const extract = () =>
    run(async () => {
      if (!pdf)
        throw new Error(
          "Pratinjau belum siap. Coba lagi atau gunakan tempel teks.",
        );
      let current = v;
      try {
        const extracted = await extractPdf(pdf, (n) =>
          setProgress(`Membaca halaman ${n}/${pdf.numPages}…`),
        );
        for (let i = 0; i < extracted.length; i += 5) {
          setProgress(
            `Menyimpan halaman ${i + 1}–${Math.min(i + 5, extracted.length)}…`,
          );
          current = await workspace.rpc("version_save_pages", {
            p_version: v.id,
            p_expected: current.row_version,
            p_page_count: pdf.numPages,
            p_pages: extracted.slice(i, i + 5),
          });
          setV(current);
        }
        await commit(current);
        if (extracted.every((p) => !p.text.trim()))
          setErr(
            "PDF tidak memiliki teks yang dapat diekstrak. Tempel teks per halaman; gambar dan tabel tetap Not assessed.",
          );
      } catch (e: any) {
        try {
          const failed = await workspace.rpc("version_extraction_failed", {
            p_version: v.id,
            p_expected: current.row_version,
            p_error: e.message,
          });
          await commit(failed);
        } catch {}
        throw e;
      }
    });
  const initializeFallback = () =>
    run(async () => {
      if (
        !Number.isInteger(Number(fallbackCount)) ||
        fallbackCount < 1 ||
        fallbackCount > 2000
      )
        throw new Error("Jumlah halaman harus 1–2000 sesuai file asli.");
      let next = v;
      for (let i = 1; i <= fallbackCount; i += 20) {
        next = await workspace.rpc("version_save_pages", {
          p_version: v.id,
          p_expected: next.row_version,
          p_page_count: Number(fallbackCount),
          p_pages: Array.from(
            { length: Math.min(20, fallbackCount - i + 1) },
            (_, j) => ({ pdf_page: i + j, text: "", source: "pasted" }),
          ),
        });
        setV(next);
      }
      await commit(next);
    });
  const currentPage = pages.find((p) => p.pdf_page === page);
  const count = pdf?.numPages || v.page_count || Number(fallbackCount) || 1;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={v.status === "confirmed" ? "teal" : "amber"}>
          v{v.sequence} · {STATUS[v.status]}
        </Badge>
        <Badge>Visual: Not assessed</Badge>
        <span className="text-xs text-ink-500">
          {fmtDate(v.created_at, true)}
        </span>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            run(async () => {
              const blob = await workspace.file(v.file_path);
              const bytes = new Uint8Array(await blob.arrayBuffer());
              if (v.file_hash && (await sha256(bytes)) !== v.file_hash)
                throw new Error("Hash file tidak cocok.");
              download(v.file_name, bytes as BlobPart, "application/pdf");
            })
          }
        >
          Unduh PDF asli
        </Button>
      </div>
      {v.change_summary && (
        <p className="whitespace-pre-wrap text-sm text-ink-600">
          {v.change_summary}
        </p>
      )}
      {err && (
        <Alert tone="error" onClose={() => setErr("")}>
          {err}{" "}
          <button className="underline" onClick={() => void onChanged()}>
            Muat ulang
          </button>
        </Alert>
      )}
      {v.error_message && (
        <Alert tone="warn">
          {v.status === "upload_failed" ? "Unggahan" : "Ekstraksi"}:{" "}
          {v.error_message}
        </Alert>
      )}
      {["uploading", "upload_failed"].includes(v.status) ? (
        <Card className="space-y-3 p-4">
          <p>
            Pilih file asli untuk melanjutkan atau mencoba unggahan ulang. Tidak
            ada file yang ditimpa.
          </p>
          <Input
            aria-label="Coba unggah ulang"
            type="file"
            accept=".pdf"
            disabled={uploadBusy}
            onChange={(e) => {
              if (e.target.files?.[0]) void onRetry(e.target.files[0]);
            }}
          />
        </Card>
      ) : (
        <>
          {viewErr && <Alert tone="warn">{viewErr}</Alert>}
          {editable && (
            <Card className="space-y-3 p-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!pdf || busy}
                  onClick={() => {
                    if (
                      !pages.length ||
                      window.confirm(
                        "Ekstraksi ulang mengganti teks yang sudah diterapkan, termasuk teks manual. Lanjutkan?",
                      )
                    )
                      void extract();
                  }}
                >
                  Ekstrak teks PDF
                </Button>
                <span className="text-xs text-ink-500 self-center">
                  Ekstraksi ulang mengganti teks manual; konfirmasikan dahulu.
                </span>
              </div>
              {!pages.length && (
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Jumlah halaman PDF asli (tempel teks)">
                    <Input
                      type="number"
                      min={1}
                      max={2000}
                      value={fallbackCount}
                      disabled={!!pdf}
                      onChange={(e) => setFallbackCount(Number(e.target.value))}
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={initializeFallback}
                  >
                    Siapkan halaman untuk teks manual
                  </Button>
                </div>
              )}
              {busy && <Spinner label={progress || "Menyimpan…"} />}
            </Card>
          )}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card className="min-w-0 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Sebelumnya
                </Button>
                <Field label="Halaman PDF asli">
                  <Input
                    className="max-w-24"
                    type="number"
                    min={1}
                    max={count}
                    value={page}
                    onChange={(e) =>
                      setPage(
                        Math.min(
                          count,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      )
                    }
                  />
                </Field>
                <span className="text-sm">/ {count}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= count}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Berikutnya
                </Button>
                <Select
                  className="max-w-28"
                  aria-label="Zoom PDF"
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                >
                  <option value={0.8}>80%</option>
                  <option value={1}>100%</option>
                  <option value={1.5}>150%</option>
                </Select>
              </div>
              <div className="max-h-[75vh] overflow-auto rounded bg-ink-50">
                <canvas
                  ref={canvas}
                  className="mx-auto max-w-full"
                  aria-label={`Pratinjau halaman PDF ${page}`}
                />
              </div>
              {!pdf && !viewErr && <Spinner label="Memuat PDF privat…" />}
              <p className="mt-2 text-xs text-ink-500">
                Indeks PDF asli {page}; label tercetak{" "}
                {currentPage?.printed_label || "belum diisi"}. Label tercetak
                tidak mengganti indeks bukti.
              </p>
            </Card>
            <div className="min-w-0 space-y-4">
              {currentPage && (
                <PageText
                  key={currentPage.id}
                  row={currentPage}
                  version={v}
                  projectId={project.id}
                  editable={editable}
                  onSave={(next) => run(() => commit(next))}
                />
              )}
              <Card className="space-y-3 p-4">
                <h3 className="font-bold">Komentar naskah</h3>
                <Select
                  aria-label="Lingkup komentar"
                  value={threadScope}
                  onChange={(e) => setThreadScope(e.target.value)}
                >
                  <option value="page">Halaman PDF {page}</option>
                  {ranges.map((r) => (
                    <option key={r.id} value={r.chapter}>
                      Bab {r.chapter.slice(1)}
                    </option>
                  ))}
                </Select>
                <Thread
                  key={`${threadScope}:${page}`}
                  projectId={project.id}
                  versionId={v.id}
                  page={threadScope === "page" ? page : null}
                  chapter={threadScope === "page" ? null : threadScope}
                />
              </Card>
            </div>
          </div>
          {pages.length > 0 && (
            <RangeEditor
              key={v.id}
              version={v}
              projectId={project.id}
              ranges={ranges}
              editable={editable}
              onSave={(next) => run(() => commit(next))}
            />
          )}
          {editable && v.status === "extracted" && (
            <Card className="space-y-3 p-4">
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Saya telah memeriksa teks dan rentang bab sesuai PDF asli. Versi
                ini akan terkunci; gambar/tabel belum dinilai.
              </label>
              <Button
                disabled={!confirmed || busy || !ranges.length}
                onClick={() =>
                  run(async () => {
                    await commit(
                      await workspace.rpc("version_confirm", {
                        p_version: v.id,
                        p_expected: v.row_version,
                      }),
                    );
                    setConfirmed(false);
                  })
                }
              >
                Konfirmasi dan kunci versi
              </Button>
            </Card>
          )}
          {v.status === "confirmed" && (
            <Alert tone="success">
              Versi telah dikonfirmasi. Teks, rentang bab, dan file tidak dapat
              ditimpa. Hash ekstraksi:{" "}
              <span className="break-all font-mono text-xs">
                {v.extraction_hash}
              </span>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
function PageText({
  row,
  version,
  projectId,
  editable,
  onSave,
}: {
  row: Row;
  version: Row;
  projectId: string;
  editable: boolean;
  onSave: (v: Row) => Promise<void>;
}) {
  const draft = useDraft(
    projectId,
    `page:${row.id}`,
    { text: row.text, printed_label: row.printed_label || "" },
    editable,
  );
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-bold">Teks halaman PDF {row.pdf_page}</h3>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Label halaman tercetak">
        <Input
          maxLength={40}
          disabled={!editable || !draft.ready}
          value={editable ? draft.value.printed_label : row.printed_label || ""}
          onChange={(e) =>
            draft.setValue({ ...draft.value, printed_label: e.target.value })
          }
        />
      </Field>
      <Field label="Teks hasil ekstraksi / tempel teks">
        <Textarea
          rows={8}
          maxLength={200000}
          readOnly={!editable}
          disabled={editable && !draft.ready}
          value={editable ? draft.value.text : row.text}
          onChange={(e) =>
            draft.setValue({ ...draft.value, text: e.target.value })
          }
        />
      </Field>
      {editable && (
        <>
          <SaveIndicator
            state={draft.state}
            onRetry={() => void draft.flush()}
            onReload={draft.reload}
          />
          <p className="text-xs text-ink-500">
            Autosave menyimpan draf privat. Terapkan teks sebelum mengunci
            versi.
          </p>
          <Button
            variant="secondary"
            loading={busy}
            disabled={!draft.ready}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                if (!(await draft.flush()))
                  throw new Error("Draf belum tersimpan.");
                const next = await workspace.rpc("version_save_pages", {
                  p_version: version.id,
                  p_expected: version.row_version,
                  p_page_count: version.page_count,
                  p_pages: [
                    {
                      pdf_page: row.pdf_page,
                      printed_label: draft.value.printed_label,
                      text: draft.value.text,
                      source: "pasted",
                    },
                  ],
                });
                await onSave(next);
              } catch (e: any) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Terapkan teks halaman
          </Button>
        </>
      )}
    </Card>
  );
}
function RangeEditor({
  version,
  projectId,
  ranges,
  editable,
  onSave,
}: {
  version: Row;
  projectId: string;
  ranges: Row[];
  editable: boolean;
  onSave: (v: Row) => Promise<void>;
}) {
  const initial = Object.fromEntries(
    CHAPTERS.map((c) => {
      const r = ranges.find((x) => x.chapter === c);
      return [
        c,
        r
          ? { start: String(r.start_page), end: String(r.end_page) }
          : { start: "", end: "" },
      ];
    }),
  );
  const draft = useDraft(projectId, `ranges:${version.id}`, initial, editable);
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState("");
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-bold">Rentang bab manual</h3>
      <p className="text-sm text-ink-500">
        Gunakan indeks halaman PDF asli. Isi bab yang ada pada naskah; rentang
        tidak boleh saling tumpang tindih.
      </p>
      {err && <Alert tone="error">{err}</Alert>}
      <div className="grid gap-3 sm:grid-cols-5">
        {CHAPTERS.map((c) => (
          <div key={c} className="space-y-2">
            <p className="text-sm font-semibold">Bab {c.slice(1)}</p>
            {["start", "end"].map((f) => (
              <Input
                key={f}
                type="number"
                min={1}
                max={version.page_count}
                aria-label={`${c} ${f === "start" ? "awal" : "akhir"}`}
                placeholder={f === "start" ? "Awal" : "Akhir"}
                disabled={!editable || !draft.ready}
                value={editable ? draft.value[c]?.[f] || "" : initial[c][f]}
                onChange={(e) =>
                  draft.setValue({
                    ...draft.value,
                    [c]: { ...draft.value[c], [f]: e.target.value },
                  })
                }
              />
            ))}
          </div>
        ))}
      </div>
      {editable && (
        <>
          <SaveIndicator
            state={draft.state}
            onRetry={() => void draft.flush()}
            onReload={draft.reload}
          />
          <Button
            variant="secondary"
            loading={busy}
            disabled={!draft.ready}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                if (!(await draft.flush()))
                  throw new Error("Draf belum tersimpan.");
                const input = CHAPTERS.filter(
                  (c) => draft.value[c].start || draft.value[c].end,
                ).map((c) => ({
                  chapter: c,
                  start_page: Number(draft.value[c].start),
                  end_page: Number(draft.value[c].end),
                }));
                const next = await workspace.rpc("version_save_ranges", {
                  p_version: version.id,
                  p_expected: version.row_version,
                  p_ranges: input,
                });
                await onSave(next);
              } catch (e: any) {
                setErr(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Terapkan rentang bab
          </Button>
        </>
      )}
    </Card>
  );
}
