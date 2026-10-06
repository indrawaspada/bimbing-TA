import { useEffect, useState } from 'react';
import { Construction } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge, Card } from '@/components/ui';

const INFO: Record<string, { title: string; desc: string; table: string }> = {
  naskah: { title: 'Naskah & versi PDF', desc: 'Unggah PDF ke storage privat, pratinjau dan ekstraksi PDF.js, rentang halaman Bab I–V, konfirmasi & segel versi, fallback tempel teks.', table: 'versions' },
  revisi: { title: 'Tracker revisi', desc: 'Open → In progress → Submitted → Verified closed / Reopened, kriteria penerimaan dan bukti revisi pada versi baru. Hanya dosen menutup/membuka ulang.', table: 'findings' },
  diskusi: { title: 'Diskusi & komentar', desc: 'Thread proyek dan komentar per bab/halaman dengan balasan; polling saat thread aktif.', table: 'comments' },
  pertemuan: { title: 'Pertemuan', desc: 'Agenda, keputusan dosen, target berikutnya, tautan rapat dan unduh ICS; tautan referensi/demo/video.', table: 'meetings' },
};

export default function PlannedTab({ tab, projectId }: { tab: string; projectId: string }) {
  const i = INFO[tab];
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    supabase.from(i.table).select('id', { count: 'exact', head: true }).eq('project_id', projectId).then(({ count }) => setCount(count ?? 0));
  }, [i.table, projectId]);
  return (
    <Card className="p-6" data-testid={`planned-${tab}`}>
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><Construction className="h-5 w-5" /></div>
        <div>
          <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{i.title}</p><Badge tone="amber">Checkpoint C</Badge></div>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{i.desc}</p>
          <p className="mt-3 text-xs text-ink-500">Tabel dan kebijakan akses (RLS) sudah aktif. Data tersimpan saat ini: <span className="font-semibold text-ink-800">{count ?? '…'}</span> baris.</p>
        </div>
      </div>
    </Card>
  );
}
