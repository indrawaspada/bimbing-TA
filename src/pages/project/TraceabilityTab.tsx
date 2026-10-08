import { Fragment, useCallback, useEffect, useState } from "react";
import { workspace, type Row } from "@/lib/workspace";
import { useAuth } from "@/lib/auth";
import { useDraft } from "@/lib/drafts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  SaveIndicator,
  Textarea,
} from "@/components/ui";
const fields: Record<string, string> = {
  objective_code: "Kode tujuan",
  problem: "Masalah",
  objective: "Tujuan",
  theory_locator: "Teori: versi/halaman/keterangan",
  method_locator: "Metode: versi/halaman/keterangan",
  evaluation: "Evaluasi",
  result_locator: "Hasil: versi/halaman/keterangan",
  conclusion_locator: "Kesimpulan: versi/halaman/keterangan",
};
export default function TraceabilityTab({ project }: { project: any }) {
  const [rows, setRows] = useState<Row[]>([]),
    [err, setErr] = useState(""),
    [show, setShow] = useState(false);
  const { isOwner } = useAuth();
  const load = useCallback(async () => {
    try {
      setRows(await workspace.rows("traceability_rows", project.id));
    } catch (e: any) {
      setErr(e.message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-4">
      <Alert>
        Matriks masalah → tujuan → teori → metode → evaluasi → hasil →
        kesimpulan. Isilah locator versi dan halaman agar dapat diperiksa. Saran
        AI hanya berasal dari lingkup terpilih dan harus diperiksa pembimbing.
      </Alert>
      {err && <Alert tone="error">{err}</Alert>}
      <Button onClick={() => setShow(!show)}>Tambah keterlacakan</Button>
      {show && <Editor project={project.id} owner={isOwner} reload={load} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead>
            <tr className="border-b">
              {[
                "Tujuan",
                "Masalah",
                "Teori / metode",
                "Evaluasi / hasil / kesimpulan",
                "Status",
              ].map((h) => (
                <th className="p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="align-top">
                  <td className="p-3">
                    {r.objective_code}
                    <p>{r.objective}</p>
                  </td>
                  <td className="p-3">{r.problem}</td>
                  <td className="p-3">
                    {r.theory_locator?.note}
                    <p>{r.method_locator?.note}</p>
                  </td>
                  <td className="p-3">
                    {r.evaluation}
                    <p>{r.result_locator?.note}</p>
                    <p>{r.conclusion_locator?.note}</p>
                  </td>
                  <td className="p-3">
                    <Badge>{r.status}</Badge>
                  </td>
                </tr>
                <tr className="border-b">
                  <td className="px-3 pb-3" colSpan={5}>
                    <details className="mt-2">
                      <summary className="cursor-pointer">
                        Ubah / verifikasi
                      </summary>
                      <Editor
                        project={project.id}
                        row={r}
                        owner={isOwner}
                        reload={load}
                      />
                    </details>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p className="text-sm">
          Belum ada baris keterlacakan. Fitur ini dapat digunakan tanpa AI.
        </p>
      )}
    </div>
  );
}
function Editor({
  project,
  row,
  owner,
  reload,
}: {
  project: string;
  row?: Row;
  owner: boolean;
  reload: () => Promise<void>;
}) {
  const initial = Object.fromEntries(
    Object.keys(fields).map((k) => [
      k,
      k.endsWith("_locator")
        ? row?.[k]?.note || ""
        : row?.[k] || (k === "objective_code" ? "T1" : ""),
    ]),
  );
  const draft = useDraft<Record<string, any>>(
    project,
    `trace:${row?.id || "new"}`,
    {
      ...initial,
      status: row?.status || "draft",
      owner_note: row?.owner_note || "",
    },
  );
  const [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Card
      className={`mt-2 space-y-3 p-3 ${row ? "w-full max-w-[calc(100vw-3.5rem)] md:max-w-none" : ""}`}
    >
      {err && <Alert tone="error">{err}</Alert>}
      {Object.entries(fields).map(([k, label]) => (
        <Field key={k} label={label}>
          {k === "objective_code" ? (
            <Input
              maxLength={20}
              disabled={!draft.ready}
              value={draft.value[k]}
              onChange={(e) =>
                draft.setValue({ ...draft.value, [k]: e.target.value })
              }
            />
          ) : (
            <Textarea
              maxLength={4000}
              disabled={!draft.ready}
              value={draft.value[k]}
              onChange={(e) =>
                draft.setValue({ ...draft.value, [k]: e.target.value })
              }
            />
          )}
        </Field>
      ))}
      <Field label="Status">
        <Select
          disabled={!draft.ready}
          value={draft.value.status}
          onChange={(e) =>
            draft.setValue({ ...draft.value, status: e.target.value })
          }
        >
          {[
            "draft",
            "proposed",
            ...(owner ? ["verified", "needs_revision"] : []),
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </Field>
      {owner && row && (
        <Field label="Catatan pembimbing">
          <Textarea
            maxLength={4000}
            value={draft.value.owner_note}
            onChange={(e) =>
              draft.setValue({ ...draft.value, owner_note: e.target.value })
            }
          />
        </Field>
      )}
      <SaveIndicator
        state={draft.state}
        onRetry={() => void draft.flush()}
        onReload={draft.reload}
      />
      <Button
        size="sm"
        loading={busy}
        disabled={!draft.ready}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            if (!(await draft.flush()))
              throw new Error("Draf belum tersimpan.");
            const values: any = {};
            for (const k of Object.keys(fields))
              values[k] = k.endsWith("_locator")
                ? { ...(row?.[k] || {}), note: draft.value[k] }
                : draft.value[k];
            values.status = draft.value.status;
            if (row && owner) values.owner_note = draft.value.owner_note;
            if (row) await workspace.update("traceability_rows", row, values);
            else
              await workspace.insert("traceability_rows", {
                ...values,
                project_id: project,
              });
            // An edit's draft already contains the saved values. Resetting it
            // here would restore the old record and persist stale values.
            if (!row) await draft.reset();
            await reload();
          } catch (e: any) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Simpan keterlacakan
      </Button>
    </Card>
  );
}
