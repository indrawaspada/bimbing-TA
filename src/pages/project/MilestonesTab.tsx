import { useState } from 'react';
import { CheckCircle2, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Milestone, Project } from '@/lib/types';
import { MILESTONE_STATUS } from '@/lib/types';
import { daysUntil, fmtDate, fromDateInput, toDateInput } from '@/lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Textarea } from '@/components/ui';

const tone = (s: string) => (s === 'selesai' ? 'green' : s === 'diajukan' ? 'teal' : s === 'berjalan' ? 'blue' : 'slate') as any;

export default function MilestonesTab({ project, milestones, onReload }: { project: Project; milestones: Milestone[]; onReload: () => Promise<void> | void }) {
  const { isOwner } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Milestone> | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<any>, msg: string) => {
    setBusy(key); setErr(null); setOk(null);
    try { await fn(); setOk(msg); await onReload(); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  const saveEdit = () => run('edit', async () => {
    const payload = { name: edit!.name, description: edit!.description || '', due_at: edit!.due_at ?? null };
    if (edit!.id) await api.updateMilestone(edit!.id, edit!.row_version!, payload);
    else await api.addMilestone({ ...payload, project_id: project.id, sort_order: milestones.length + 1, status: 'belum', progress_note: '' });
    setEdit(null);
  }, 'Milestone tersimpan.');

  return (
    <div className="space-y-4" data-testid="milestones-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">{isOwner ? 'Dosen menetapkan target dan mengesahkan penyelesaian.' : 'Laporkan progres dan ajukan bila target sudah tercapai. Dosen yang mengesahkan.'}</p>
        {isOwner && <Button data-testid="add-milestone" onClick={() => setEdit({ name: '', description: '', due_at: null })}><Plus className="h-4 w-4" />Tambah milestone</Button>}
      </div>
      {err && <Alert tone="error" onClose={() => setErr(null)}>{err}</Alert>}
      {ok && <Alert tone="success" onClose={() => setOk(null)}>{ok}</Alert>}
      {milestones.length === 0 && <Empty title="Belum ada milestone">{isOwner ? 'Tambahkan target bimbingan pertama.' : 'Dosen belum menetapkan target.'}</Empty>}
      <ol className="space-y-3">
        {milestones.map((m, idx) => {
          const d = daysUntil(m.due_at); const note = notes[m.id] ?? m.progress_note;
          return (
            <li key={m.id}>
              <Card className="p-4 sm:p-5" data-testid="milestone-row">
                <div className="flex gap-4">
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${m.status === 'selesai' ? 'bg-emerald-100 text-emerald-800' : 'bg-ink-50 text-ink-700'}`}>
                    {m.status === 'selesai' ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold">{m.name}</p><Badge tone={tone(m.status)}>{MILESTONE_STATUS[m.status]}</Badge>
                      {m.status !== 'selesai' && d !== null && (d < 0 ? <Badge tone="red">Terlambat {-d} hari</Badge> : d <= 7 ? <Badge tone="amber">Jatuh tempo {d === 0 ? 'hari ini' : `${d} hari`}</Badge> : null)}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500">Tenggat: {m.due_at ? fmtDate(m.due_at) : '—'}{m.completed_at ? ` · selesai ${fmtDate(m.completed_at)}` : ''}</p>
                    {m.description && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-700">{m.description}</p>}
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_200px]">
                      <Textarea aria-label="Catatan progres" rows={2} className="min-h-[64px]" placeholder="Catatan progres mahasiswa…" value={note} disabled={m.status === 'selesai' && !isOwner}
                        onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} />
                      <Select aria-label="Status milestone" value={m.status} disabled={!!busy || (!isOwner && m.status === 'selesai')}
                        onChange={(e) => run(m.id, () => api.updateMilestone(m.id, m.row_version, { status: e.target.value as any }), 'Status diperbarui.')}>
                        {Object.entries(MILESTONE_STATUS).filter(([k]) => isOwner || k !== 'selesai' || m.status === 'selesai').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {note !== m.progress_note && <Button size="sm" loading={busy === m.id + 'n'} onClick={() => run(m.id + 'n', () => api.updateMilestone(m.id, m.row_version, { progress_note: note }), 'Catatan progres tersimpan.')}><Send className="h-4 w-4" />Simpan catatan</Button>}
                      {!isOwner && m.status !== 'selesai' && m.status !== 'diajukan' && <Button size="sm" variant="teal" onClick={() => run(m.id, () => api.updateMilestone(m.id, m.row_version, { status: 'diajukan', progress_note: note }), 'Diajukan ke dosen.')}>Ajukan selesai</Button>}
                      {isOwner && m.status === 'diajukan' && <Button size="sm" variant="teal" onClick={() => run(m.id, () => api.updateMilestone(m.id, m.row_version, { status: 'selesai' }), 'Milestone disahkan selesai.')}><CheckCircle2 className="h-4 w-4" />Sahkan selesai</Button>}
                      {isOwner && <Button size="sm" variant="ghost" onClick={() => setEdit(m)}><Pencil className="h-4 w-4" />Ubah</Button>}
                      {isOwner && <Button size="sm" variant="ghost" aria-label="Hapus milestone" onClick={() => confirm(`Hapus milestone "${m.name}"?`) && run(m.id, () => api.deleteMilestone(m.id), 'Milestone dihapus.')}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <Modal open={!!edit} title={edit?.id ? 'Ubah milestone' : 'Milestone baru'} onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button><Button data-testid="milestone-save" loading={busy === 'edit'} disabled={(edit?.name || '').trim().length < 2} onClick={saveEdit}>Simpan</Button></>}>
        <Field label="Nama"><Input data-testid="milestone-name" value={edit?.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Tenggat (WIB)"><Input type="date" value={toDateInput(edit?.due_at)} onChange={(e) => setEdit({ ...edit, due_at: fromDateInput(e.target.value) })} /></Field>
        <Field label="Deskripsi / checklist"><Textarea value={edit?.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
