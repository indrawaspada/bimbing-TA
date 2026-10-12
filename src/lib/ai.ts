import { supabase } from "./supabase";
export const AI_MESSAGES: Record<string, string> = {
  bounded_thinking_required:
    "Konfigurasi Gemini memerlukan batas thinking yang didukung model. Periksa kemampuan model di Pengaturan.",
  ai_disabled: "AI belum diaktifkan atau anggaran bulan ini belum tersedia.",
  provider_not_configured:
    "API key provider belum dikonfigurasi pada Supabase Secrets.",
  model_not_allowed:
    "Model belum diuji/diaktifkan atau tidak diizinkan untuk akun Anda.",
  consent_required:
    "Simpan persetujuan proyek dan pilihan data/provider terlebih dahulu.",
  scope_token_limit_reduce_pages:
    "Lingkup terlalu panjang. Pilih lebih sedikit halaman atau kutipan; tidak ada teks yang dipotong otomatis.",
  sealed_version_required:
    "Gunakan versi naskah yang sudah dikonfirmasi dan dikunci.",
  scope_outside_chapter:
    "Halaman harus berada dalam rentang bab yang dikonfirmasi.",
  missing_page_text:
    "Teks halaman belum lengkap. Periksa hasil ekstraksi di tab Naskah.",
  budget_exceeded:
    "Batas biaya atau jumlah panggilan tercapai. Hubungi pembimbing.",
  project_busy:
    "Proyek sedang diproses. Muat ulang status; jangan mengirim permintaan baru.",
  provider_key_rejected:
    "Provider menolak API key. Periksa konfigurasi server.",
  provider_rate_limit:
    "Batas provider tercapai; tidak dilakukan retry otomatis.",
  provider_timeout_or_network:
    "Hasil panggilan belum pasti. Reservasi tetap dihitung sampai diperiksa.",
  invalid_json: "Provider tidak mengembalikan JSON yang valid.",
  invalid_schema: "Struktur hasil AI tidak sesuai kontrak.",
  unknown_rule: "Hasil menyebut aturan yang tidak tersedia dalam rubrik.",
  preview_changed_review_again:
    "Konteks berubah. Periksa kembali pratinjau sebelum mengirim.",
  chat_requires_excerpt_or_review:
    "Dialog memerlukan kutipan terpilih atau review tersimpan.",
  evidence_unverified:
    "Bukti belum terverifikasi. Periksa naskah dan buat revisi manual bila diperlukan.",
  model_not_live_tested: "Uji koneksi model ini sebelum mengaktifkannya.",
  edit_conflict: "Data berubah di sesi lain. Muat ulang sebelum menyimpan.",
};
export function aiMessage(code: string) {
  return (
    AI_MESSAGES[code] ||
    `Operasi AI gagal (${code}). Tidak ada retry atau fallback otomatis.`
  );
}
export async function invokeAI(input: Record<string, any>) {
  const { data, error } = await supabase.functions.invoke("ai", {
    body: input,
  });
  if (error) {
    let code = "edge_function_unavailable";
    try {
      code = (await (error as any).context.json()).error || code;
    } catch {}
    if (code === "edge_function_unavailable")
      throw new Error(
        "Fungsi AI belum tersedia. Alur manual tetap dapat dipakai; periksa deployment fungsi dan ALLOWED_ORIGINS.",
      );
    throw new Error(aiMessage(code));
  }
  if (data?.error) throw new Error(aiMessage(data.error));
  return data;
}
export function currentAIMonth() {
  return new Date().toISOString().slice(0, 7);
}
