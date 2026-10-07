import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDraft } from "@/lib/drafts";
import {
  workspace,
  download,
  safeHttps,
  fromWIB,
  localWIB,
  type Row,
} from "@/lib/workspace";
import { meetingIcs } from "@/lib/export-utils";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  SaveIndicator,
  Spinner,
  Textarea,
} from "@/components/ui";
export default function MeetingsTab({ project }: { project: any }) {
  const { isOwner } = useAuth();
  const [rows, setRows] = useState<Row[]>([]),
    [err, setErr] = useState(""),
    [edit, setEdit] = useState<Row | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const r = await workspace.rows("meetings", project.id);
      setRows(r.sort((a, b) => b.meeting_at.localeCompare(a.meeting_at)));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-bold text-lg">Pertemuan bimbingan</h2>
        {isOwner && (
          <Button
            onClick={() => setEdit(edit === undefined ? null : undefined)}
          >
            {edit === undefined ? "Jadwalkan pertemuan" : "Tutup formulir"}
          </Button>
        )}
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {isOwner && edit !== undefined && (
        <MeetingForm
          key={edit?.id || "new"}
          row={edit}
          projectId={project.id}
          onDone={async () => {
            setEdit(undefined);
            await load();
          }}
        />
      )}
      {!rows.length && (
        <Empty title="Belum ada pertemuan">
          Dosen dapat mencatat jadwal, keputusan, dan target berikutnya.
        </Empty>
      )}
      {rows.map((m) => (
        <Card key={m.id} className="space-y-3 p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-bold">{m.title}</h3>
            <span className="text-sm text-teal-700">
              {fmtDate(m.meeting_at, true)} · {m.duration_min} menit
            </span>
          </div>
          {m.agenda && (
            <p className="whitespace-pre-wrap text-sm">
              <strong>Agenda: </strong>
              {m.agenda}
            </p>
          )}
          {m.decisions && (
            <p className="whitespace-pre-wrap text-sm">
              <strong>Keputusan dosen: </strong>
              {m.decisions}
            </p>
          )}
          {m.next_targets && (
            <p className="whitespace-pre-wrap text-sm">
              <strong>Target berikutnya: </strong>
              {m.next_targets}
            </p>
          )}
          {m.next_due_at && (
            <p className="text-sm">
              Tenggat target: {fmtDate(m.next_due_at, true)}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {m.meeting_url && (
              <a
                className="self-center text-sm font-semibold text-teal-700 underline"
                href={m.meeting_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Buka tautan pertemuan
              </a>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                download(
                  `pertemuan-${m.id}.ics`,
                  meetingIcs(m),
                  "text/calendar;charset=utf-8",
                )
              }
            >
              Unduh kalender ICS
            </Button>
            {isOwner && (
              <Button variant="ghost" size="sm" onClick={() => setEdit(m)}>
                Ubah pertemuan
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
function MeetingForm({
  row,
  projectId,
  onDone,
}: {
  row: Row | null;
  projectId: string;
  onDone: () => Promise<void>;
}) {
  const d = useDraft(projectId, `meeting:${row?.id || "new"}`, {
    title: row?.title || "Bimbingan",
    meeting_at: localWIB(row?.meeting_at),
    duration_min: row?.duration_min || 60,
    agenda: row?.agenda || "",
    decisions: row?.decisions || "",
    next_targets: row?.next_targets || "",
    next_due_at: localWIB(row?.next_due_at),
    meeting_url: row?.meeting_url || "",
  });
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  if (!d.ready)
    return (
      <Card className="p-4">
        <SaveIndicator state={d.state} onRetry={d.reload} />
        <Spinner label="Memuat draf pertemuan…" />
      </Card>
    );
  return (
    <Card className="space-y-3 p-4">
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Judul">
        <Input
          maxLength={200}
          value={d.value.title}
          onChange={(e) => d.setValue({ ...d.value, title: e.target.value })}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Waktu pertemuan (WIB)">
          <Input
            type="datetime-local"
            value={d.value.meeting_at}
            onChange={(e) =>
              d.setValue({ ...d.value, meeting_at: e.target.value })
            }
          />
        </Field>
        <Field label="Durasi menit">
          <Input
            type="number"
            min={5}
            max={600}
            value={d.value.duration_min}
            onChange={(e) =>
              d.setValue({ ...d.value, duration_min: Number(e.target.value) })
            }
          />
        </Field>
      </div>
      {["agenda", "decisions", "next_targets"].map((f) => (
        <Field
          key={f}
          label={
            {
              agenda: "Agenda",
              decisions: "Keputusan dosen",
              next_targets: "Target berikutnya",
            }[f]!
          }
        >
          <Textarea
            maxLength={8000}
            value={d.value[f]}
            onChange={(e) => d.setValue({ ...d.value, [f]: e.target.value })}
          />
        </Field>
      ))}
      <Field label="Tenggat target berikutnya (WIB)">
        <Input
          type="datetime-local"
          value={d.value.next_due_at}
          onChange={(e) =>
            d.setValue({ ...d.value, next_due_at: e.target.value })
          }
        />
      </Field>
      <Field label="Tautan pertemuan HTTPS (opsional)">
        <Input
          type="url"
          maxLength={1000}
          value={d.value.meeting_url}
          onChange={(e) =>
            d.setValue({ ...d.value, meeting_url: e.target.value })
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
        disabled={!d.ready || !d.value.meeting_at || !d.value.title.trim()}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            if (!(await d.flush())) throw new Error("Draf belum tersimpan.");
            const values = {
              ...d.value,
              meeting_at: fromWIB(d.value.meeting_at),
              next_due_at: fromWIB(d.value.next_due_at),
              meeting_url: d.value.meeting_url
                ? safeHttps(d.value.meeting_url)
                : null,
            };
            if (row) await workspace.update("meetings", row, values);
            else
              await workspace.insert("meetings", {
                ...values,
                project_id: projectId,
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
        Simpan pertemuan
      </Button>
    </Card>
  );
}
