import { useState } from 'react';
import { ShieldCheck, FileSearch, ListChecks } from 'lucide-react';
import { signInWithGoogle } from '@/lib/auth';
import { Alert, Button } from '@/components/ui';
import { Logo } from '@/components/AppShell';

export default function Login({ next }: { next?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (next && next !== '/') sessionStorage.setItem('bt_next', next);
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink-900 p-12 lg:flex lg:flex-col">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />
        <div className="absolute -bottom-40 left-10 h-96 w-96 rounded-full bg-blue-400/10 blur-3xl" />
        <Logo />
        <div className="relative mt-auto max-w-lg">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-300">Bimbingan Tugas Akhir Informatika</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.1] tracking-tight text-white">Satu ruang untuk naskah, revisi, dan keputusan bimbingan.</h1>
          <p className="mt-4 text-base leading-relaxed text-ink-200">Akses privat untuk dosen pembimbing dan mahasiswa yang diundang. Setiap mahasiswa hanya melihat proyeknya sendiri.</p>
          <ul className="mt-10 space-y-4 text-sm text-ink-100">
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-teal-400" />Login Google terverifikasi + daftar undangan email</li>
            <li className="flex gap-3"><FileSearch className="h-5 w-5 shrink-0 text-teal-400" />Versi naskah PDF tersegel dengan bukti per halaman</li>
            <li className="flex gap-3"><ListChecks className="h-5 w-5 shrink-0 text-teal-400" />Revisi ditutup hanya oleh dosen; AI sebatas draf</li>
          </ul>
        </div>
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mb-10 lg:hidden"><div className="inline-flex rounded-xl bg-ink-900 p-3"><Logo /></div></div>
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-extrabold tracking-tight">Masuk</h2>
          <p className="mt-2 text-sm text-ink-500">Gunakan akun Google dengan email yang telah didaftarkan oleh dosen pembimbing.</p>
          {err && <div className="mt-4"><Alert tone="error">{err}</Alert></div>}
          <Button data-testid="google-login" className="mt-6 w-full" variant="secondary" loading={busy}
            onClick={async () => { setBusy(true); setErr(null); try { await signInWithGoogle(); } catch (e: any) { setErr(e.message); setBusy(false); } }}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.3 6.6 2.3 12s4.3 9.8 9.7 9.8c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z"/></svg>
            Masuk dengan Google
          </Button>
          <p className="mt-6 text-xs leading-relaxed text-ink-500">Tidak ada pendaftaran terbuka. Akun yang belum diundang akan melihat status “Menunggu akses” tanpa data apa pun.</p>
        </div>
      </section>
    </div>
  );
}
