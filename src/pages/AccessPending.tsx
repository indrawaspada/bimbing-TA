import { Clock, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Alert, Button, Card } from '@/components/ui';

const REASONS: Record<string, string> = {
  not_invited: 'Email ini belum ada di daftar undangan. Minta dosen pembimbing menambahkan email Anda, lalu muat ulang.',
  email_unverified: 'Email akun belum terverifikasi oleh penyedia login.',
  provider_not_allowed: 'Gunakan tombol “Masuk dengan Google”. Metode login lain tidak diizinkan.',
  owner_exists: 'Undangan owner tidak berlaku karena owner sudah ditetapkan.',
};

export default function AccessPending() {
  const { membership, session, error, refresh, signOut } = useAuth();
  const email = (membership as any)?.email || session?.user?.email;
  const reason = membership?.status === 'pending' ? REASONS[membership.reason] : membership?.status === 'inactive' ? 'Akses akun ini sedang dinonaktifkan oleh dosen pembimbing.' : null;
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4">
      <Card className="w-full max-w-md p-8 text-center" data-testid="access-pending">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-50 ring-1 ring-amber-200"><Clock className="h-7 w-7 text-amber-600" /></div>
        <h1 className="mt-5 text-xl font-extrabold">Menunggu akses</h1>
        <p className="mt-2 text-sm text-ink-500">Masuk sebagai <span className="font-semibold text-ink-800">{email || '—'}</span></p>
        <div className="mt-5 text-left">
          {error ? <Alert tone="error" title="Tidak dapat memeriksa akses">{error}</Alert>
            : <Alert tone="warn">{reason || 'Akun Anda belum terhubung ke ruang bimbingan.'}</Alert>}
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" onClick={refresh}><RefreshCw className="h-4 w-4" />Periksa lagi</Button>
          <Button className="flex-1" variant="secondary" onClick={signOut}><LogOut className="h-4 w-4" />Ganti akun</Button>
        </div>
      </Card>
    </div>
  );
}
