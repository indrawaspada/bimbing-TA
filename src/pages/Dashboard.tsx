import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CalendarClock, ChevronRight, ClipboardCheck, FolderOpen, Search, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { Invitation, Member, Milestone, Project } from '@/lib/types';
import { PROFILES, STAGES, PROJECT_STATUS } from '@/lib/types';
import { daysUntil, fmtDate, fmtRelative } from '@/lib/format';
import { Alert, Badge, Button, Card, Empty, Input, PageHeader, Select, Spinner } from '@/components/ui';

export function useStudentNames(members: Member[], invitations: Invitation[]) {
  return useMemo(() => {
    const byUid = new Map(members.map((m) => [m.auth_user_id, m]));
    const byInv = new Map(invitations.map((i) => [i.id, i]));
    return (p: Project) => {
      const m = p.student_uid ? byUid.get(p.student_uid) : undefined;
      const i = p.invitation_id ? byInv.get(p.invitation_id) : undefined;
      return { name: m?.display_name || i?.display_name || m?.verified_email || i?.normalized_email || 'Belum ditugaskan', email: m?.verified_email || i?.normalized_email, claimed: !!p.student_uid, active: m ? m.active : true };
    };
  }, [members, invitations]);
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone: string }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-lg ${tone}`}><Icon className="h-5 w-5" aria-hidden /></div>
        <div><p className="text-2xl font-extrabold leading-none tracking-tight">{value}</p><p className="mt-1 text-xs font-medium text-ink-500">{label}</p></div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<{ projects: Project[]; members: Member[]; invitations: Invitation[]; milestones: Milestone[]; counts: Record<string, { open: number; submitted: number }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('aktif');

  useEffect(() => {
    Promise.all([api.projects(), api.members(), api.invitations(), api.milestones(), api.openFindingCounts()])
      .then(([projects, members, invitations, milestones, counts]) => setData({ projects, members, invitations, milestones, counts }))
      .catch((e) => setErr(e.message));
  }, []);
  const nameOf = useStudentNames(data?.members || [], data?.invitations || []);

  if (err) return <Alert tone="error" title="Gagal memuat dashboard">{err}</Alert>;
  if (!data) return <Spinner />;

  const nextMs = (pid: string) => data.milestones.filter((m) => m.project_id === pid && m.status !== 'selesai').sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'))[0];
  const dueSoon = data.milestones.filter((m) => m.status !== 'selesai' && (daysUntil(m.due_at) ?? 99) <= 7);
  const totals = Object.values(data.counts).reduce((a, c) => ({ open: a.open + c.open, submitted: a.submitted + c.submitted }), { open: 0, submitted: 0 });
  const list = data.projects.filter((p) => (!status || p.status === status) && (!stage || p.stage === stage)
    && (!q || `${p.title} ${nameOf(p).name} ${p.student_label || ''}`.toLowerCase().includes(q.toLowerCase())));

  return (
    <div data-testid="owner-dashboard">
      <PageHeader title="Dashboard bimbingan" subtitle={`${data.projects.filter((p) => p.status === 'aktif').length} proyek aktif · diperbarui ${fmtDate(new Date().toISOString(), true)}`}
        actions={<Link to="/mahasiswa"><Button><Users className="h-4 w-4" />Kelola mahasiswa</Button></Link>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FolderOpen} label="Proyek aktif" value={data.projects.filter((p) => p.status === 'aktif').length} tone="bg-ink-50 text-ink-700" />
        <Stat icon={AlertCircle} label="Revisi terbuka" value={totals.open} tone="bg-amber-50 text-amber-700" />
        <Stat icon={ClipboardCheck} label="Menunggu verifikasi" value={totals.submitted} tone="bg-teal-50 text-teal-700" />
        <Stat icon={CalendarClock} label="Target ≤ 7 hari" value={dueSoon.length} tone="bg-red-50 text-red-700" />
      </div>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-300" /><Input aria-label="Cari" placeholder="Cari judul, nama mahasiswa, NIM…" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Select aria-label="Filter tahap" className="sm:w-44" value={stage} onChange={(e) => setStage(e.target.value)}><option value="">Semua tahap</option>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select aria-label="Filter status" className="sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Semua status</option>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>

      <div className="mt-4 space-y-3">
        {list.length === 0 && <Empty icon={<FolderOpen className="h-10 w-10" />} title={data.projects.length ? 'Tidak ada proyek yang cocok' : 'Belum ada proyek'}>
          {data.projects.length ? 'Ubah filter pencarian.' : 'Tambahkan email mahasiswa ke daftar undangan, lalu buat proyek TA untuknya.'}</Empty>}
        {list.map((p) => {
          const s = nameOf(p); const ms = nextMs(p.id); const d = daysUntil(ms?.due_at); const c = data.counts[p.id] || { open: 0, submitted: 0 };
          return (
            <Link key={p.id} to={`/proyek/${p.id}`} data-testid="project-row" className="group block">
              <Card className="flex flex-col gap-3 p-4 transition group-hover:border-teal-200 group-hover:shadow-md sm:flex-row sm:items-center sm:p-5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-bold text-teal-300">{s.name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-ink-900">{s.name}</p>
                    {p.student_label && <span className="text-xs text-ink-500">{p.student_label}</span>}
                    {!s.claimed && <Badge tone="amber">Undangan belum diklaim</Badge>}
                    {s.claimed && !s.active && <Badge tone="red">Akses nonaktif</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-ink-700">{p.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone="blue">{STAGES[p.stage]}</Badge><Badge>{PROFILES[p.research_profile]}</Badge>
                    {c.open > 0 && <Badge tone="amber">{c.open} revisi terbuka</Badge>}{c.submitted > 0 && <Badge tone="teal">{c.submitted} menunggu verifikasi</Badge>}</div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:w-64 sm:justify-end">
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-ink-500">Target berikutnya</p>
                    <p className="text-sm font-semibold">{ms ? ms.name : '—'}</p>
                    {ms?.due_at && <p className={`text-xs font-medium ${d !== null && d < 0 ? 'text-red-700' : d !== null && d <= 7 ? 'text-amber-700' : 'text-ink-500'}`}>{d !== null && d < 0 ? `Terlambat ${-d} hari` : `${fmtDate(ms.due_at)}`}</p>}
                    <p className="text-[11px] text-ink-300">aktivitas {fmtRelative(p.updated_at)}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-ink-300 group-hover:text-teal-600" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
