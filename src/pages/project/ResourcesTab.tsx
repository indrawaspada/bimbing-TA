import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDraft } from "@/lib/drafts";
import { workspace, safeHttps, type Row } from "@/lib/workspace";
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
export default function ResourcesTab({ projectId }: { projectId: string }) {
  const { isOwner, session } = useAuth();
  const [rows, setRows] = useState<Row[]>([]),
    [err, setErr] = useState(""),
    [edit, setEdit] = useState<Row | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setRows(await workspace.rows("resources", projectId));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="text-lg font-bold">Referensi, demo, dan video</h2>
        <Button onClick={() => setEdit(edit === undefined ? null : undefined)}>
          {edit === undefined ? "Tambah tautan" : "Tutup formulir"}
        </Button>
      </div>
      {err && <Alert tone="error">{err}</Alert>}
      {edit !== undefined && (
        <ResourceForm
          key={edit?.id || "new"}
          row={edit}
          projectId={projectId}
          onDone={async () => {
            setEdit(undefined);
            await load();
          }}
        />
      )}
      {!rows.length && (
        <Empty title="Belum ada sumber">
          Tambahkan referensi ilmiah, repositori, demo aplikasi, atau video
          melalui tautan HTTPS.
        </Empty>
      )}
      {rows.map((r) => (
        <Card key={r.id} className="space-y-2 p-4">
          <Badge>{r.kind}</Badge>
          <h3 className="font-bold">{r.title}</h3>
          {r.https_url && (
            <a
              className="block break-all text-sm text-teal-700 underline"
              href={r.https_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {r.https_url}
            </a>
          )}
          <p className="whitespace-pre-wrap text-sm">{r.note}</p>
          {(isOwner || r.created_by === session?.user.id) && (
            <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>
              Ubah tautan
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
function ResourceForm({
  row,
  projectId,
  onDone,
}: {
  row: Row | null;
  projectId: string;
  onDone: () => Promise<void>;
}) {
  const d = useDraft(projectId, `resource:${row?.id || "new"}`, {
    title: row?.title || "",
    kind: row?.kind || "paper",
    https_url: row?.https_url || "",
    note: row?.note || "",
  });
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  if (!d.ready)
    return (
      <Card className="p-4">
        <SaveIndicator state={d.state} onRetry={d.reload} />
        <Spinner label="Memuat draf sumber…" />
      </Card>
    );
  return (
    <Card className="space-y-3 p-4">
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Judul sumber">
        <Input
          maxLength={300}
          value={d.value.title}
          onChange={(e) => d.setValue({ ...d.value, title: e.target.value })}
        />
      </Field>
      <Field label="Jenis">
        <Select
          value={d.value.kind}
          onChange={(e) => d.setValue({ ...d.value, kind: e.target.value })}
        >
          {["paper", "repo", "demo", "video", "lainnya"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </Select>
      </Field>
      <Field label="Tautan HTTPS">
        <Input
          type="url"
          maxLength={2000}
          value={d.value.https_url}
          onChange={(e) =>
            d.setValue({ ...d.value, https_url: e.target.value })
          }
        />
      </Field>
      <Field label="Catatan">
        <Textarea
          maxLength={4000}
          value={d.value.note}
          onChange={(e) => d.setValue({ ...d.value, note: e.target.value })}
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
          !d.ready || d.value.title.trim().length < 2 || !d.value.https_url
        }
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            if (!(await d.flush())) throw new Error("Draf belum tersimpan.");
            const values = {
              ...d.value,
              https_url: safeHttps(d.value.https_url),
            };
            if (row) await workspace.update("resources", row, values);
            else
              await workspace.insert("resources", {
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
        Simpan tautan
      </Button>
    </Card>
  );
}
