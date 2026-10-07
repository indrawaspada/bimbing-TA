import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anon && !url.includes('YOUR-PROJECT-REF'));

// Publishable/anon key only. All authorization is enforced by Postgres RLS + RPC on the server.
export const supabase: SupabaseClient = isConfigured
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } })
  : (null as unknown as SupabaseClient);

const MESSAGES: Record<string, string> = {
  unapplied_drafts: 'Ada draf teks atau rentang bab yang belum diterapkan. Terapkan perubahan sebelum mengunci versi.',
  version_deletion_pending: 'Versi sedang dalam proses penghapusan setelah ekspor; referensi baru tidak dapat ditambahkan.',
  edit_conflict: 'Konflik: data berubah di sesi lain. Muat ulang sebelum menyimpan.',
  invalid_transition: 'Perubahan status tidak tersedia dari keadaan saat ini.',
  proof_version_invalid: 'Bukti harus berupa versi baru yang terkunci, dengan halaman valid dan uraian perbaikan.',
  text_confirmation_required: 'Lengkapi teks pada bab yang dipilih sebelum mengunci versi.',
  extraction_required: 'Lengkapi ekstraksi, teks, dan rentang bab terlebih dahulu.',
  chapter_ranges_overlap: 'Rentang bab saling tumpang tindih.',
  version_delete_blocked: 'Versi ini tidak dapat dihapus: periksa backup, versi terbaru, dan referensi bukti atau komentar.',
  uploaded_size_mismatch: 'Ukuran file tersimpan berbeda dari reservasi. Unggahan ditolak.',
  reopen_reason_required: 'Isi alasan membuka kembali revisi.',
  owner_only: 'Hanya dosen pembimbing (owner) yang dapat melakukan tindakan ini.',
  owner_only_field: 'Kolom ini hanya dapat diubah oleh dosen pembimbing.',
  owner_approves_completion: 'Penyelesaian milestone disahkan oleh dosen. Ajukan status "Diajukan".',
  immutable_field: 'Relasi data ini tidak dapat diubah.',
  owner_uid_immutable: 'Pemilik proyek tidak dapat diubah.',
  assignment_transfer_not_supported: 'Pemindahan proyek antarmahasiswa tidak tersedia pada MVP.',
  project_quota_exceeded: 'Kuota penyimpanan proyek terlampaui. Minta dosen mengarsipkan versi lama.',
  global_storage_guard: 'Kapasitas penyimpanan aplikasi hampir penuh. Unggahan baru diblokir sementara.',
  file_too_large: 'Ukuran berkas melebihi 25 MB.',
  version_sealed: 'Versi sudah dikunci (sealed) dan tidak dapat diubah.',
  use_transition_rpc: 'Status revisi hanya berubah melalui alur revisi.',
  cannot_change_owner: 'Status owner tidak dapat diubah.',
  invitation_claimed_email_immutable: 'Email undangan yang sudah diklaim tidak dapat diubah.',
};

export function errorMessage(err: any): string {
  if (!err) return 'Terjadi kesalahan tidak dikenal.';
  const raw = String(err.message || err.error_description || err);
  for (const k of Object.keys(MESSAGES)) if (raw.includes(k)) return MESSAGES[k];
  if (err.code === '23505') return 'Data yang sama sudah ada (duplikat).';
  if (err.code === '42501' || /permission denied|row-level security/i.test(raw)) return 'Akses ditolak oleh kebijakan keamanan.';
  if (err.code === '23514') return 'Isian tidak memenuhi aturan validasi.';
  if (/Failed to fetch|NetworkError/i.test(raw)) return 'Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.';
  return raw;
}

/** Throws on error so callers never show false success. */
export async function must<T>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(errorMessage(error));
  return data;
}
