import AISettings from '@/components/AISettings';
import { useEffect, useState } from 'react';
import { BookCheck, HardDrive, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { bytes, fmtDate } from '@/lib/format';
import { Badge, Button, Card, PageHeader } from '@/components/ui';

export default function SettingsPage() {
  const { membership, isOwner, signOut } = useAuth();
  const [cfg, setCfg] = useState<any>(null);
  const [rubric, setRubric] = useState<any>(null);
  useEffect(() => { api.appConfig().then(setCfg).catch(() => {}); api.rubric().then(setRubric).catch(() => {}); }, []);
  const m = membership?.status === 'active' ? membership : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Pengaturan" />
      <Card className="p-5">
        <p className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-teal-700" />Akun</p>
        <p className="mt-2 text-sm">{m?.display_name} · <span className="text-ink-500">{m?.email}</span></p>
        <p className="mt-1 text-sm">Peran: <Badge tone="teal">{isOwner ? 'Dosen pembimbing (owner)' : 'Mahasiswa'}</Badge></p>
        <p className="mt-2 text-xs text-ink-500">Peran ditentukan oleh server dari undangan terverifikasi dan tidak dapat diubah dari aplikasi.</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={signOut}><LogOut className="h-4 w-4" />Keluar</Button>
      </Card>
      {cfg && (
        <Card className="p-5">
          <p className="flex items-center gap-2 font-bold"><HardDrive className="h-4 w-4" />Penyimpanan</p>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            <li>Batas per berkas PDF: {bytes(cfg.max_file_bytes)} (disarankan &lt; {bytes(cfg.suggested_file_bytes)})</li>
            <li>Kuota default per proyek: {bytes(cfg.default_project_quota_bytes)}</li>
            <li>Pengaman kapasitas global aplikasi: {bytes(cfg.global_storage_limit_bytes)} (bukan jaminan kuota provider)</li>
          </ul>
        </Card>
      )}
      {rubric && (
        <Card className="p-5">
          <p className="flex items-center gap-2 font-bold"><BookCheck className="h-4 w-4" />Rubrik aktif</p>
          <p className="mt-2 text-sm">{rubric.version} · {rubric.rule_count} aturan · dimuat {fmtDate(rubric.created_at)}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink-500">sha256 {rubric.source_sha256}</p>
          <p className="mt-2"><Badge tone={rubric.weights_provisional ? 'amber' : 'teal'}>{rubric.dimension_weights?.label || 'Bobot belum ditetapkan'}</Badge> <span className="text-xs text-ink-500">dapat disesuaikan dosen</span></p>
          {rubric.dimension_weights?.stage_chapter_weights?.final && <p className="mt-1 text-xs text-ink-500">Bobot bab (final): {Object.entries(rubric.dimension_weights.stage_chapter_weights.final).map(([k, v]) => `${k} ${v}%`).join(' · ')} · proposal dinormalisasi untuk Bab I–III</p>}
        </Card>
      )}
      {isOwner ? <AISettings /> : <Card className="p-5"><p className="font-bold">Asisten AI</p><p className="mt-2 text-sm">Gunakan tab Asisten AI pada proyek. Model dan anggaran ditentukan pembimbing; alur manual tetap tersedia.</p></Card>}
    </div>
  );
}
