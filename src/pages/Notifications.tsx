import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CalendarClock } from "lucide-react";
import { supabase, must } from "@/lib/supabase";
import { api } from "@/lib/api";
import type { Milestone, Project } from "@/lib/types";
import { daysUntil, fmtDate, fmtRelative } from "@/lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  PageHeader,
  Spinner,
} from "@/components/ui";

export default function Notifications() {
  const [items, setItems] = useState<any[] | null>(null);
  const [due, setDue] = useState<(Milestone & { project?: Project })[]>([]);
  const [extraDue, setExtraDue] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    Promise.all([
      must(
        supabase
          .from("notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
      ),
      api.milestones(),
      api.projects(),
      must(
        supabase
          .from("findings")
          .select("id,project_id,title,due_at,workflow_status")
          .neq("workflow_status", "verified_closed")
          .eq("approval_state", "accepted"),
      ),
      must(supabase.from("meetings").select("id,project_id,title,next_due_at")),
    ])
      .then(([n, ms, ps, findings, meetings]: any) => {
        setItems(n);
        setExtraDue(
          [
            ...findings.map((f: any) => ({ ...f, tab: "revisi" })),
            ...meetings
              .filter((m: any) => m.next_due_at)
              .map((m: any) => ({
                ...m,
                due_at: m.next_due_at,
                tab: "pertemuan",
                title: `Target pertemuan: ${m.title}`,
              })),
          ].filter((x: any) => (daysUntil(x.due_at) ?? 99) <= 7),
        );
        setDue(
          ms
            .filter(
              (m: Milestone) =>
                m.status !== "selesai" && (daysUntil(m.due_at) ?? 99) <= 7,
            )
            .map((m: Milestone) => ({
              ...m,
              project: ps.find((p: Project) => p.id === m.project_id),
            })),
        );
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  if (err) return <Alert tone="error">{err}</Alert>;
  if (!items) return <Spinner />;
  const unread = items.filter((i) => !i.read_at);
  return (
    <div>
      <PageHeader
        title="Notifikasi"
        subtitle="Hanya di dalam aplikasi — tanpa email atau push."
        actions={
          unread.length > 0 && (
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await must(
                    supabase
                      .from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .is("read_at", null)
                      .select(),
                  );
                  window.dispatchEvent(new Event("notifications-read"));
                  load();
                } catch (e: any) {
                  setErr(e.message);
                }
              }}
            >
              Tandai semua dibaca
            </Button>
          )
        }
      />
      {(due.length > 0 || extraDue.length > 0) && (
        <Card className="mb-5 p-5">
          <p className="flex items-center gap-2 font-bold">
            <CalendarClock className="h-4 w-4 text-amber-700" />
            Jatuh tempo ≤ 7 hari
          </p>
          <ul className="mt-3 divide-y divide-ink-100">
            {due.map((m) => {
              const d = daysUntil(m.due_at)!;
              return (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <Link
                    to={`/proyek/${m.project_id}/target`}
                    className="font-semibold hover:underline"
                  >
                    {m.name}{" "}
                    <span className="font-normal text-ink-500">
                      · {m.project?.title}
                    </span>
                  </Link>
                  <span className="flex items-center gap-2">
                    {fmtDate(m.due_at)}
                    {d < 0 ? (
                      <Badge tone="red">Terlambat</Badge>
                    ) : (
                      <Badge tone="amber">{d} hari</Badge>
                    )}
                  </span>
                </li>
              );
            })}
            {extraDue.map((x) => (
              <li
                key={x.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
              >
                <Link
                  className="font-semibold hover:underline"
                  to={`/proyek/${x.project_id}/${x.tab}`}
                >
                  {x.title}
                </Link>
                <span>
                  {fmtDate(x.due_at)}{" "}
                  <Badge tone={daysUntil(x.due_at)! < 0 ? "red" : "amber"}>
                    {daysUntil(x.due_at)! < 0 ? "Terlambat" : "Segera"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {items.length === 0 ? (
        <Empty
          icon={<Bell className="h-10 w-10" />}
          title="Belum ada notifikasi"
        >
          Komentar, revisi, dan pertemuan baru akan muncul di sini.
        </Empty>
      ) : (
        <Card className="divide-y divide-ink-100">
          {items.map((n) => (
            <Link
              key={n.id}
              to={
                n.project_id
                  ? `/proyek/${n.project_id}/${({ comments: "diskusi", findings: "revisi", meetings: "pertemuan", versions: "naskah", resources: "sumber" } as any)[n.type] || "ringkasan"}`
                  : "#"
              }
              onClick={async () => {
                if (n.read_at) return;
                try {
                  await must(
                    supabase
                      .from("notifications")
                      .update({ read_at: new Date().toISOString() })
                      .eq("id", n.id),
                  );
                  window.dispatchEvent(new Event("notifications-read"));
                } catch (e: any) {
                  setErr(e.message);
                }
              }}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-ink-50"
            >
              {!n.read_at && (
                <span
                  className="h-2 w-2 rounded-full bg-teal-500"
                  aria-label="Belum dibaca"
                />
              )}
              <span className="flex-1 text-sm">{n.title || n.type}</span>
              <span className="text-xs text-ink-500">
                {fmtRelative(n.created_at)}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
