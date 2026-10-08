import { useCallback, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useActivePolling, useDraft } from "@/lib/drafts";
import { workspace, type Row } from "@/lib/workspace";
import { must, supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/format";
import {
  Alert,
  Button,
  Card,
  Empty,
  SaveIndicator,
  Textarea,
} from "@/components/ui";
export default function Thread({
  projectId,
  versionId = null,
  page = null,
  chapter = null,
  findingId = null,
}: {
  projectId: string;
  versionId?: string | null;
  page?: number | null;
  chapter?: string | null;
  findingId?: string | null;
}) {
  const { session, isOwner } = useAuth();
  const [rows, setRows] = useState<Row[]>([]),
    [err, setErr] = useState(""),
    [sending, setSending] = useState(false),
    [reply, setReply] = useState<string | null>(null);
  const key = [projectId, versionId, page, chapter, findingId].join(":");
  const draft = useDraft(projectId, `comment:${key}`, {
    body: "",
    parent_id: null as string | null,
  });
  const load = useCallback(async () => {
    try {
      let q = supabase
        .from("comments")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at");
      for (const [field, v] of Object.entries({
        version_id: versionId,
        pdf_page: page,
        chapter,
        finding_id: findingId,
      }))
        q = v === null ? q.is(field, null) : q.eq(field, v);
      const all: Row[] = [];
      for (let from = 0; ; from += 500) {
        const part = (await must(q.order("id").range(from, from + 499))) || [];
        all.push(...part);
        if (part.length < 500) break;
      }
      setRows(all);
      setErr("");
    } catch (e: any) {
      setErr(e.message);
    }
  }, [key]);
  useActivePolling(load, key);
  const send = async () => {
    setSending(true);
    setErr("");
    try {
      if (!(await draft.flush()))
        throw new Error(
          "Draf belum tersimpan. Selesaikan konflik atau coba lagi.",
        );
      await workspace.insert("comments", {
        project_id: projectId,
        version_id: versionId,
        pdf_page: page,
        chapter,
        finding_id: findingId,
        parent_id: draft.value.parent_id,
        body: draft.value.body.trim(),
      });
      await draft.reset();
      setReply(null);
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="space-y-3" aria-label="Komentar dan balasan">
      <p className="text-xs text-ink-500">
        Komentar diperbarui tiap 15 detik saat tab ini terlihat.
      </p>
      {err && <Alert tone="error">{err}</Alert>}
      {!rows.length && (
        <Empty title="Belum ada komentar">
          Mulai diskusi atau tinggalkan catatan untuk pembimbing.
        </Empty>
      )}
      <div className="max-h-[480px] space-y-2 overflow-y-auto">
        {rows.map((r) => (
          <Card
            key={r.id}
            className={`p-3 ${r.parent_id ? "ml-5 border-l-4 border-l-teal-200" : ""}`}
          >
            <div className="mb-1 flex justify-between text-xs text-ink-500">
              <span>
                {r.author_uid === session?.user.id
                  ? "Anda"
                  : isOwner
                    ? "Mahasiswa"
                    : "Dosen"}{" "}
                · {fmtDate(r.created_at, true)}
                {r.edited_at ? " · diedit" : ""}
              </span>
            </div>
            {r.parent_id && (
              <p className="mb-1 truncate text-xs text-teal-700">
                Balasan:{" "}
                {rows.find((x) => x.id === r.parent_id)?.body ||
                  "Komentar sebelumnya"}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words text-sm">{r.body}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReply(r.id);
                draft.setValue({ ...draft.value, parent_id: r.id });
              }}
            >
              Balas
            </Button>
          </Card>
        ))}
      </div>
      <div className="space-y-2">
        {(reply || draft.value.parent_id) && (
          <p className="text-xs text-teal-800">
            Membalas komentar{" "}
            <button
              className="underline"
              onClick={() => {
                setReply(null);
                draft.setValue({ ...draft.value, parent_id: null });
              }}
            >
              Batalkan balasan
            </button>
          </p>
        )}
        <Textarea
          aria-label="Isi komentar"
          rows={3}
          maxLength={8000}
          disabled={!draft.ready || sending}
          value={draft.value.body}
          onChange={(e) =>
            draft.setValue({ ...draft.value, body: e.target.value })
          }
          placeholder="Tulis komentar…"
        />
        <SaveIndicator
          state={draft.state}
          onRetry={() => void draft.flush()}
          onReload={draft.reload}
        />
        <div>
          <Button
            loading={sending}
            disabled={
              !draft.ready ||
              !draft.value.body.trim() ||
              draft.state.kind === "conflict"
            }
            onClick={send}
          >
            Kirim komentar
          </Button>
        </div>
      </div>
    </section>
  );
}
