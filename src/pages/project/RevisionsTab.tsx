import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDraft } from "@/lib/drafts";
import { workspace, STATUS, CHAPTERS, type Row } from "@/lib/workspace";
import { fmtDate, daysUntil, fromDateInput, toDateInput } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  SaveIndicator,
  Spinner,
  Textarea,
} from "@/components/ui";
import Thread from "./Thread";
export default function RevisionsTab({ project }: { project: any }) {
  const { isOwner } = useAuth();
  const [rows, setRows] = useState<Row[]>([]),
    [versions, setVersions] = useState<Row[]>([]),
    [err, setErr] = useState(""),
    [creating, setCreating] = useState(false),
    [filter, setFilter] = useState("active");
  const load = useCallback(async () => {
    try {
      const [f, v] = await Promise.all([
        workspace.rows("findings", project.id),
        workspace.rows("versions", project.id),
      ]);
      setRows(f.filter(x => x.approval_state === "accepted"));
      setVersions(v.filter((x) => x.status === "confirmed"));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const shown = rows.filter(
    (r) =>
      r.approval_state === "accepted" &&
      (filter === "all" ||
        (filter === "active"
          ? r.workflow_status !== "verified_closed"
          : r.workflow_status === filter)),
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="font-bold text-lg">Revisi dan bukti perbaikan</h2>
        {isOwner && (
          <Button onClick={() => setCreating((v) => !v)}>
            {creating ? "Tutup formulir" : "Tambah revisi"}
          </Button>
        )}
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {creating && (
        <FindingForm
          projectId={project.id}
          versions={versions}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}
      <Select
        aria-label="Filter revisi"
        className="max-w-xs"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="active">Revisi aktif</option>
        <option value="all">Semua revisi</option>
        {[
          "open",
          "in_progress",
          "submitted",
          "verified_closed",
          "reopened",
        ].map((s) => (
          <option key={s} value={s}>
            {STATUS[s]}
          </option>
        ))}
      </Select>
      {!shown.length && (
        <Empty title="Belum ada revisi dalam filter ini">
          Dosen dapat membuat revisi dengan kriteria penerimaan dan halaman
          sumber.
        </Empty>
      )}
      {shown.map((r) => (
        <Revision
          key={`${r.id}:${r.row_version}`}
          row={r}
          versions={versions}
          owner={isOwner}
          reload={load}
        />
      ))}
    </div>
  );
}
function FindingForm({
  projectId,
  versions,
  onDone,
  row,
}: {
  projectId: string;
  versions: Row[];
  onDone: () => Promise<void>;
  row?: Row;
}) {
  const initial = {
    title: row?.title || "",
    version_id: row?.version_id || "",
    chapter: row?.chapter || "UMUM",
    severity: row?.severity || "Major",
    reason: row?.reason || "",
    recommendation: row?.recommendation || "",
    acceptance_criterion: row?.acceptance_criterion || "",
    due: toDateInput(row?.due_at),
    page: String(row?.locator?.pdf_page || ""),
  };
  const d = useDraft(projectId, `finding:${row?.id || "new"}`, initial);
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  if (!d.ready)
    return (
      <Card className="p-4">
        <SaveIndicator state={d.state} onRetry={d.reload} />
        <Spinner label="Memuat draf revisi…" />
      </Card>
    );
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-bold">{row ? "Ubah revisi" : "Revisi baru"}</h3>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Judul revisi">
        <Input
          maxLength={300}
          value={d.value.title}
          disabled={!d.ready}
          onChange={(e) => d.setValue({ ...d.value, title: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Versi sumber">
          <Select
            value={d.value.version_id}
            disabled={!!row || !d.ready}
            onChange={(e) =>
              d.setValue({ ...d.value, version_id: e.target.value })
            }
          >
            <option value="">Umum / belum ada naskah</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.sequence} · {v.file_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Indeks halaman PDF asli (opsional)">
          <Input
            type="number"
            min={1}
            value={d.value.page}
            onChange={(e) => d.setValue({ ...d.value, page: e.target.value })}
          />
        </Field>
        <Field label="Bab">
          <Select
            value={d.value.chapter}
            onChange={(e) =>
              d.setValue({ ...d.value, chapter: e.target.value })
            }
          >
            <option value="UMUM">Umum</option>
            {CHAPTERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Keparahan">
          <Select
            value={d.value.severity}
            onChange={(e) =>
              d.setValue({ ...d.value, severity: e.target.value })
            }
          >
            {["Critical", "Major", "Minor", "Review"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Alasan / masalah">
        <Textarea
          maxLength={8000}
          value={d.value.reason}
          onChange={(e) => d.setValue({ ...d.value, reason: e.target.value })}
        />
      </Field>
      <Field label="Saran perbaikan">
        <Textarea
          maxLength={8000}
          value={d.value.recommendation}
          onChange={(e) =>
            d.setValue({ ...d.value, recommendation: e.target.value })
          }
        />
      </Field>
      <Field label="Kriteria penerimaan (wajib)">
        <Textarea
          maxLength={4000}
          value={d.value.acceptance_criterion}
          onChange={(e) =>
            d.setValue({ ...d.value, acceptance_criterion: e.target.value })
          }
        />
      </Field>
      <Field label="Tenggat (WIB)">
        <Input
          type="date"
          value={d.value.due}
          onChange={(e) => d.setValue({ ...d.value, due: e.target.value })}
        />
      </Field>
      <SaveIndicator
        state={d.state}
        onRetry={() => void d.flush()}
        onReload={d.reload}
      />
      <Button
        loading={busy}
        disabled={
          !d.ready ||
          !d.value.title.trim() ||
          !d.value.acceptance_criterion.trim()
        }
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            if (!(await d.flush())) throw new Error("Draf belum tersimpan.");
            const source = versions.find((v) => v.id === d.value.version_id);
            const pg = Number(d.value.page);
            if (
              d.value.page &&
              (!source ||
                !Number.isInteger(pg) ||
                pg < 1 ||
                pg > source.page_count)
            )
              throw new Error(
                "Halaman sumber harus berada dalam versi yang dipilih.",
              );
            const values = {
              title: d.value.title.trim(),
              chapter: d.value.chapter,
              severity: d.value.severity,
              reason: d.value.reason,
              recommendation: d.value.recommendation,
              acceptance_criterion: d.value.acceptance_criterion,
              due_at: d.value.due ? fromDateInput(d.value.due) : null,
              locator: pg ? { pdf_page: pg } : {},
              evidence_type: "manual",
            };
            if (row) await workspace.update("findings", row, values);
            else
              await workspace.insert("findings", {
                ...values,
                project_id: projectId,
                version_id: d.value.version_id || null,
              });
            await d.reset();
            await onDone();
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {row ? "Terapkan perubahan" : "Buat revisi"}
      </Button>
    </Card>
  );
}
function Revision({
  row,
  versions,
  owner,
  reload,
}: {
  row: Row;
  versions: Row[];
  owner: boolean;
  reload: () => Promise<void>;
}) {
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [proof, setProof] = useState(false),
    [thread, setThread] = useState(false),
    [edit, setEdit] = useState(false);
  const transition = async (status: string, data?: any, reason?: string) => {
    setBusy(true);
    setErr("");
    try {
      await workspace.rpc("finding_transition", {
        p_finding: row.id,
        p_expected: row.row_version,
        p_status: status,
        p_proof: data || null,
        p_reason: reason || null,
      });
      await reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const due = daysUntil(row.due_at);
  const source = versions.find((v) => v.id === row.version_id);
  const pv = versions.find((v) => v.id === row.revision_proof?.version_id);
  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        <Badge
          tone={row.workflow_status === "verified_closed" ? "teal" : "amber"}
        >
          {STATUS[row.workflow_status]}
        </Badge>
        <Badge tone={row.severity === "Critical" ? "red" : "slate"}>
          {row.severity}
        </Badge>
        <Badge>{row.chapter || "Umum"}</Badge>
        {row.due_at && row.workflow_status !== "verified_closed" && (
          <Badge tone={due !== null && due <= 7 ? "red" : "slate"}>
            Tenggat {fmtDate(row.due_at)}
          </Badge>
        )}
      </div>
      <h3 className="font-bold">{row.title}</h3>
      {source && (
        <p className="text-xs text-ink-500">
          Sumber v{source.sequence}
          {row.locator?.pdf_page
            ? ` · PDF asli halaman ${row.locator.pdf_page}`
            : ""}
        </p>
      )}
      {row.reason && (
        <p className="whitespace-pre-wrap break-words text-sm">{row.reason}</p>
      )}
      {row.recommendation && (
        <p className="whitespace-pre-wrap break-words text-sm">
          <strong>Saran: </strong>
          {row.recommendation}
        </p>
      )}
      <div className="rounded-lg bg-teal-50 p-3 text-sm">
        <strong>Kriteria penerimaan: </strong>
        <span className="whitespace-pre-wrap">
          {row.acceptance_criterion || "Belum diisi dosen"}
        </span>
      </div>
      {row.revision_proof && (
        <div className="rounded-lg bg-ink-50 p-3 text-sm">
          <strong>Bukti: </strong>v{pv?.sequence || "?"} · halaman PDF{" "}
          {row.revision_proof.start_page}–{row.revision_proof.end_page}
          <p className="whitespace-pre-wrap">
            {row.revision_proof.description}
          </p>
        </div>
      )}
      {err && (
        <Alert tone="error">
          {err}{" "}
          <button className="underline" onClick={() => void reload()}>
            Muat ulang data
          </button>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {["open", "reopened"].includes(row.workflow_status) && (
          <Button
            size="sm"
            loading={busy}
            onClick={() => transition("in_progress")}
          >
            Mulai kerjakan
          </Button>
        )}
        {["open", "in_progress", "reopened"].includes(row.workflow_status) && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setProof((v) => !v)}
          >
            Ajukan bukti perbaikan
          </Button>
        )}
        {owner && row.workflow_status === "submitted" && (
          <Button
            size="sm"
            loading={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Sudah memeriksa bukti dan kriteria penerimaan? Tutup revisi sebagai terverifikasi.",
                )
              )
                void transition("verified_closed");
            }}
          >
            Verifikasi selesai
          </Button>
        )}
        {owner &&
          ["submitted", "verified_closed"].includes(row.workflow_status) && (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              onClick={() => {
                const reason = window.prompt(
                  "Alasan membuka kembali revisi (wajib):",
                );
                if (reason?.trim()) void transition("reopened", null, reason);
              }}
            >
              Buka kembali
            </Button>
          )}
        {owner && (
          <Button size="sm" variant="ghost" onClick={() => setEdit((v) => !v)}>
            Ubah instruksi
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setThread((v) => !v)}>
          {thread ? "Tutup komentar" : "Komentar revisi"}
        </Button>
      </div>
      {proof && (
        <ProofForm
          row={row}
          versions={versions}
          onSubmit={async (data) => {
            await transition("submitted", data);
          }}
        />
      )}
      {edit && (
        <FindingForm
          projectId={row.project_id}
          row={row}
          versions={versions}
          onDone={reload}
        />
      )}
      {thread && <Thread projectId={row.project_id} findingId={row.id} />}
    </Card>
  );
}
function ProofForm({
  row,
  versions,
  onSubmit,
}: {
  row: Row;
  versions: Row[];
  onSubmit: (p: any) => Promise<void>;
}) {
  const d = useDraft(row.project_id, `proof:${row.id}`, {
    version_id: "",
    start_page: "1",
    end_page: "1",
    description: "",
  });
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const base = versions.find((v) => v.id === row.version_id);
  const newer = versions.filter((v) =>
    base
      ? v.sequence > base.sequence
      : new Date(v.confirmed_at) > new Date(row.created_at),
  );
  if (!d.ready)
    return (
      <div>
        <SaveIndicator state={d.state} onRetry={d.reload} />
        <Spinner label="Memuat draf bukti…" />
      </div>
    );
  return (
    <div className="space-y-3 rounded-lg border border-ink-200 p-3">
      <p className="text-sm">
        Bukti harus berasal dari versi baru yang telah dikonfirmasi.
      </p>
      {!newer.length && (
        <Alert tone="warn">
          Belum ada versi baru yang terkunci. Unggah dan konfirmasi naskah
          perbaikan pada tab Naskah.
        </Alert>
      )}
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Versi bukti">
        <Select
          value={d.value.version_id}
          onChange={(e) =>
            d.setValue({ ...d.value, version_id: e.target.value })
          }
        >
          <option value="">Pilih versi baru</option>
          {newer.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.sequence} · {v.file_name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {["start_page", "end_page"].map((f) => (
          <Field
            key={f}
            label={
              f === "start_page"
                ? "PDF asli halaman awal"
                : "PDF asli halaman akhir"
            }
          >
            <Input
              type="number"
              min={1}
              value={d.value[f]}
              onChange={(e) => d.setValue({ ...d.value, [f]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <Field label="Perbaikan yang memenuhi kriteria">
        <Textarea
          maxLength={4000}
          value={d.value.description}
          onChange={(e) =>
            d.setValue({ ...d.value, description: e.target.value })
          }
        />
      </Field>
      <SaveIndicator
        state={d.state}
        onRetry={() => void d.flush()}
        onReload={d.reload}
      />
      <Button
        loading={busy}
        disabled={
          !d.ready || !d.value.version_id || !d.value.description.trim()
        }
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            if (!(await d.flush())) throw new Error("Draf belum tersimpan.");
            await onSubmit({
              ...d.value,
              start_page: Number(d.value.start_page),
              end_page: Number(d.value.end_page),
            });
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Ajukan kepada dosen
      </Button>
    </div>
  );
}
