import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Flag, HardDrive } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useAutosave } from '@/lib/autosave';
import { api } from '@/lib/api';
import type { Milestone, Project } from '@/lib/types';
import { MILESTONE_STATUS, PROFILES, PROJECT_STATUS, STAGES } from '@/lib/types';
import { bytes, daysUntil, fmtDate } from '@/lib/format';
import { Alert, Badge, Button, Card, Field, Input, SaveIndicator, Select, Textarea } from '@/components/ui';

export default function SummaryTab({ project, milestones, onChanged, onReload }: { project: Project; milestones: Milestone[]; onChanged: (p: Project) => void; onReload: () => void }) {
  const { isOwner } = useAuth();
  const nav = useNavigate();
  const pick = (p: Project) => isOwner
    ? { title: p.title, summary: p.summary, research_profile: p.research_profile, stage: p.stage, status: p.status, student_label: p.student_label || '' }
    : { title: p.title, summary: p.summary };
  const [vals, setVals] = useState<any>(pick(project));
  const [delErr, setDelErr] = useState<string | null>(null);
  const onSaved = useCallback((row: Project) => onChanged(row), [onChanged]);
  const valid = vals.title.trim().length >= 3;
  const auto = useAutosave({ table: 'projects', id: project.id, rowVersion: project.row_version, values: vals, enabled: valid, onSaved });
  useEffect(() => { auto.resetBaseline(pick(project)); setVals(pick(project)); /* eslint-disable-next-line */ }, [project.id]);

  const reloadLatest = async () => { const p = await api.project(project.id); if (p) { onChanged(p); setVals(pick(p)); auto.resetBaseline(pick(p)); } };
  const next = milestones.filter((m) => m.status !== 'selesai').sort((a, b) => (a.due_at || '9').localeCompare(b.due_at || '9'))[0];
  const d = daysUntil(next?.due_at);
  const set = (k: string) => (e: any) => setVals({ ...vals, [k]: e.target.value });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Profil tugas akhir</h2>
          <SaveIndicator state={auto.state} onRetry={auto.retry} onOverwrite={auto.overwrite} onReload={reloadLatest} />
        </div>
        <div className="space-y-4">
          <Field label="Judul" hint={!valid ? 'Minimal 3 karakter; belum disimpan.' : undefined}><Input data-testid="project-title" value={vals.title} onChange={set('title')} /></Field>
          <Field label="Ringkasan / latar belakang singkat"><Textarea data-testid="project-summary" rows={6} value={vals.summary} onChange={set('summary')} placeholder="Masalah, tujuan, dan pendekatan dalam beberapa kalimat…" /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Profil penelitian" hint={!isOwner ? 'Ditentukan dosen' : undefined}>
              <Select disabled={!isOwner} value={isOwner ? vals.research_profile : project.research_profile} onChange={set('research_profile')}>{Object.entries(PROFILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Tahap" hint={!isOwner ? 'Ditentukan dosen' : undefined}>
              <Select disabled={!isOwner} value={isOwner ? vals.stage : project.stage} onChange={set('stage')}>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Status proyek">
              <Select disabled={!isOwner} value={isOwner ? vals.status : project.status} onChange={set('status')}>{Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </div>
          {isOwner && <Field label="Label mahasiswa (NIM/angkatan)"><Input value={vals.student_label} onChange={set('student_label')} /></Field>}
          <p className="text-xs text-ink-500">Tersimpan otomatis. Bila data diubah di sesi lain, Anda akan diminta memilih — tidak ada penimpaan diam-diam.</p>
        </div>
      </Card>

      <div className="space-y-4">
        <Card className="overflow-hidden" data-testid="next-step-card">
          <div className="bg-ink-900 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-wider text-teal-300">Langkah berikutnya</p>
            <p className="mt-1 text-lg font-bold text-white">{next ? next.name : 'Semua milestone selesai'}</p></div>
          <div className="space-y-2 px-5 py-4 text-sm">
            {next ? <>
              <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-ink-500" />{next.due_at ? fmtDate(next.due_at) : 'Tenggat belum ditentukan'}
                {d !== null && (d < 0 ? <Badge tone="red">Terlambat {-d} hari</Badge> : d <= 7 ? <Badge tone="amber">{d} hari lagi</Badge> : null)}</p>
              <p className="flex items-center gap-2"><Flag className="h-4 w-4 text-ink-500" />{MILESTONE_STATUS[next.status]}</p>
            </> : <p className="text-ink-500">Tambahkan target baru di tab Target.</p>}
            <Link to={`/proyek/${project.id}/target`} className="inline-block pt-1 font-semibold text-teal-700 hover:underline">Lihat semua target →</Link>
          </div>
        </Card>
        <Card className="p-5 text-sm">
          <p className="flex items-center gap-2 font-bold"><HardDrive className="h-4 w-4" />Kuota penyimpanan</p>
          <p className="mt-1 text-ink-500">Batas proyek {bytes(project.storage_limit_bytes)} · PDF maks. 25 MB, disarankan &lt; 5 MB.</p>
        </Card>
        {isOwner && (
          <Card className="p-5 text-sm">
            <p className="font-bold text-red-800">Hapus proyek</p>
            <p className="mt-1 text-ink-500">Permanen. Lakukan ekspor/backup terlebih dahulu.</p>
            {delErr && <div className="mt-2"><Alert tone="error">{delErr}</Alert></div>}
            <Button size="sm" variant="danger" className="mt-3" onClick={async () => {
              const t = prompt(`Ketik judul proyek untuk konfirmasi:\n${project.title}`);
              if (t !== project.title) return;
              try { await api.deleteProject(project.id); nav('/dashboard'); } catch (e: any) { setDelErr(e.message); }
            }}>Hapus proyek…</Button>
          </Card>
        )}
        <button className="hidden" onClick={onReload} />
      </div>
    </div>
  );
}
