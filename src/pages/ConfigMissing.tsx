import { Settings2 } from 'lucide-react';
import { Card } from '@/components/ui';

export default function ConfigMissing() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4">
      <Card className="w-full max-w-lg p-8" data-testid="config-missing">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-ink-900"><Settings2 className="h-6 w-6 text-teal-400" /></div>
        <h1 className="mt-5 text-xl font-extrabold">Konfigurasi Supabase belum diisi</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">Frontend memerlukan dua nilai publik. Isi pada <code className="rounded bg-ink-50 px-1">.env.local</code> (pengembangan) atau Environment Variables Cloudflare Pages, lalu build ulang:</p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-ink-950 p-4 text-xs leading-relaxed text-teal-200">{`VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable/anon key>`}</pre>
        <p className="mt-4 text-xs text-ink-500">Jangan pernah memasukkan service_role key atau API key provider AI ke variabel VITE_.</p>
      </Card>
    </div>
  );
}
