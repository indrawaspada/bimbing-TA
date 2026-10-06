import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailPlus, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { api } from '@/lib/api';
import type { Invitation, Member, Project } from '@/lib/types';
import { PROFILES, STAGES } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui';

export default function Students() {
  const [inv, setInv] = useState<Invitation[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [projFor, setProjFor] = useState<Invitation | null>(null);

  const load = useCallback(() => {
    Promise.all([api.invitations(), api.members(), api.projects()]).then(([i, m, p]) => { setInv(i); setMembers(m); setProjects(p); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try { await api.invite(form.email, form.name, form.note); setForm({ email: '', name: '', note: '' }); setMsg('Email ditambahkan ke daftar undangan. Mahasiswa cukup login dengan Google memakai email tersebut.'); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<any>, ok: string) => { setErr(null); setMsg(null); try { await fn(); setMsg(ok); load(); } catch (e: any) { setErr(e.message); } };

  if (!inv) return err ? <Alert tone="error">{err}</Alert> : <Spinner />;
  const students = inv.filter((i) => i.role === 'student');

  return (
    <div>
      <PageHeader title="Mahasiswa & undangan" subtitle={`${students.length} email di daftar undangan · kapasitas awal 20 mahasiswa`} />
      {err && <div className="mb-4"><Alert tone="error" onClose={() => setErr(null)}>{err}</Alert></div>}
      {msg && <div className="mb-4"><Alert tone="success" onClose={() => setMsg(null)}>{msg}</Alert></div>}
      <Card className="p-5">
        <form onSubmit={invite} className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto] md:items-end" data-testid="invite-form">
          <Field label="Email Google mahasiswa"><Input required type="email" placeholder="nama@students.example.ac.id" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Nama tampilan"><Input placeholder="Opsional" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Catatan"><Input placeholder="mis. NIM / angkatan" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          <Button type="submit" loading={busy}><MailPlus className="h-4 w-4" />Undang</Button>
        </form>
        <p className="mt-3 text-xs text-ink-500">Tidak ada email otomatis. Klaim hanya berhasil bila email Google terverifikasi sama persis dengan undangan aktif.</p>
      </Card>

      <div className="mt-6 space-y-3">
        {students.length === 0 && <Empty title="Belum ada undangan">Tambahkan email mahasiswa bimbingan di atas.</Empty>}
        {students.map((i) => {
          const m = members.find((x) => x.auth_user_id === i.claimed_uid);
          const p = projects.find((x) => x.invitation_id === i.id);
          return (
            <Card key={i.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center" data-testid="invitation-row">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{i.display_name || i.normalized_email}</p>
                  {i.claimed_uid ? <Badge tone="teal">Terhubung {fmtDate(i.claimed_at)}</Badge> : <Badge tone="amber">Belum login</Badge>}
                  {!i.active && <Badge tone="red">Undangan nonaktif</Badge>}
                  {m && !m.active && <Badge tone="red">Akses dinonaktifkan</Badge>}
                </div>
                <p className="text-sm text-ink-500">{i.normalized_email}{i.note ? ` · ${i.note}` : ''}</p>
                {p && <Link className="mt-1 inline-block text-sm font-semibold text-teal-700 hover:underline" to={`/proyek/${p.id}`}>{p.title}</Link>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!p && <Button size="sm" variant="teal" onClick={() => setProjFor(i)}><Plus className="h-4 w-4" />Buat proyek</Button>}
                {m ? (m.active
                  ? <Button size="sm" variant="danger" onClick={() => act(() => api.setMemberActive(m.id, false), 'Akses mahasiswa dinonaktifkan.')}><UserX className="h-4 w-4" />Nonaktifkan</Button>
                  : <Button size="sm" variant="secondary" onClick={() => act(() => api.setMemberActive(m.id, true), 'Akses mahasiswa diaktifkan.')}><UserCheck className="h-4 w-4" />Aktifkan</Button>)
                  : <Button size="sm" variant="secondary" onClick={() => act(() => api.setInvitationActive(i.id, !i.active), i.active ? 'Undangan dinonaktifkan.' : 'Undangan diaktifkan.')}>{i.active ? 'Nonaktifkan undangan' : 'Aktifkan undangan'}</Button>}
                {!i.claimed_uid && !p && <Button size="sm" variant="ghost" aria-label="Hapus undangan" onClick={() => confirm('Hapus undangan ini?') && act(() => api.deleteInvitation(i.id), 'Undangan dihapus.')}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </Card>
          );
        })}
      </div>
      <CreateProjectModal invitation={projFor} onClose={() => setProjFor(null)} onCreated={() => { setProjFor(null); setMsg('Proyek dibuat dengan milestone awal.'); load(); }} />
    </div>
  );
}

function CreateProjectModal({ invitation, onClose, onCreated }: { invitation: Invitation | null; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ title: '', research_profile: 'software_si', stage: 'proposal', student_label: '', withDefaults: true });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setF((x) => ({ ...x, student_label: invitation?.note || '' })); setErr(null); }, [invitation]);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.createProject({ ...f, invitation_id: invitation!.id }); onCreated(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!invitation} title="Buat proyek TA" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button onClick={submit} loading={busy} disabled={f.title.trim().length < 3} data-testid="create-project-submit">Simpan proyek</Button></>}>
      <p className="text-sm text-ink-500">Untuk <span className="font-semibold text-ink-800">{invitation?.display_name || invitation?.normalized_email}</span></p>
      {err && <Alert tone="error">{err}</Alert>}
      <Field label="Judul sementara"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Judul tugas akhir" /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Profil penelitian"><Select value={f.research_profile} onChange={(e) => setF({ ...f, research_profile: e.target.value })}>{Object.entries(PROFILES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="Tahap"><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{Object.entries(STAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
      </div>
      <Field label="Label mahasiswa (NIM/angkatan)"><Input value={f.student_label} onChange={(e) => setF({ ...f, student_label: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-teal-600" checked={f.withDefaults} onChange={(e) => setF({ ...f, withDefaults: e.target.checked })} />Tambahkan 5 milestone standar (Proposal → Naskah akhir)</label>
    </Modal>
  );
}
