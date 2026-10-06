import { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAutosave } from '@/lib/autosave';
import { Alert, Card, SaveIndicator, Spinner, Textarea } from '@/components/ui';

export default function PrivateNotesTab({ projectId }: { projectId: string }) {
  const [note, setNote] = useState<any>(null);
  const [body, setBody] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try { const n = (await api.privateNote(projectId)) || (await api.createPrivateNote(projectId)); setNote(n); setBody(n.body); }
      catch (e: any) { setErr(e.message); }
    })();
  }, [projectId]);
  const onSaved = useCallback((row: any) => setNote(row), []);
  const auto = useAutosave({ table: 'private_notes', id: note?.id || '', rowVersion: note?.row_version || 0, values: { body }, enabled: !!note, onSaved });
  useEffect(() => { if (note) auto.resetBaseline({ body: note.body }); /* eslint-disable-next-line */ }, [note?.id]);
  if (err) return <Alert tone="error">{err}</Alert>;
  if (!note) return <Spinner />;
  return (
    <Card className="p-5 sm:p-6" data-testid="private-notes">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-bold"><Lock className="h-4 w-4 text-teal-700" />Catatan privat dosen</p>
        <SaveIndicator state={auto.state} onRetry={auto.retry} onOverwrite={auto.overwrite}
          onReload={async () => { const n = await api.privateNote(projectId); setNote(n); setBody(n.body); auto.resetBaseline({ body: n.body }); }} />
      </div>
      <p className="mb-3 text-sm text-ink-500">Disimpan di tabel terpisah. Tidak pernah tampil, diekspor, atau dapat diakses mahasiswa.</p>
      <Textarea rows={14} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Observasi, pertimbangan penilaian, hal yang perlu dipantau…" />
    </Card>
  );
}
