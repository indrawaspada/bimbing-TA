# BimbingTA Copilot — SDD dan Rencana Emergent Maksimum 50 Kredit

## Keputusan desain

BimbingTA Copilot — aplikasi bimbingan TA Informatika privat. Pemilik: Dr. Indra Waspada, S.T., M.T.I. Asumsi kapasitas awal: 1 dosen dan hingga 20 mahasiswa; dapat diubah tanpa mengubah arsitektur. Bahasa Indonesia; desktop untuk review, Android untuk tindak lanjut. Pengembangan di Emergent.sh; target maksimum 50 kredit pembangunan, tidak termasuk API provider dan hosting produksi Emergent. Ini paket desain/SDD/instruksi pembangunan, bukan aplikasi yang telah dibuat atau diuji langsung di Emergent.

## Kelayakan 50 kredit

Konsumsi Emergent bergantung pada pekerjaan agent, debugging dan integrasi, sehingga 50 kredit tidak dapat dijamin oleh spesifikasi. Target dibuat dengan scope P0 yang dibekukan, arsitektur kecil dan checkpoint. Tidak memakai estimasi kredit yang dilaporkan agent sebagai angka aktual; baca saldo/usage dashboard. Sebelum memulai catat saldo awal, gunakan satu sesi proyek, dan hitung sisa. Bila layanan tidak mempunyai hard cap per job, pengendalian ini manual.
Bila tersisa <=7 kredit, hentikan penambahan fitur, ekspor kode lalu gunakan cadangan hanya untuk blocker login, otorisasi, penyimpanan, build atau API. Jangan menghabiskan saldo untuk redesign. Bila suatu checkpoint gagal berulang dua kali, minta diagnosis singkat dan patch minimal; lanjutkan perbaikan di editor luar Emergent bila saldo tidak memadai.

## Arsitektur yang dipilih

React + TypeScript + Vite + Tailwind; React Router; UI component sederhana yang konsisten. Supabase menyediakan Auth, Postgres, private Storage dan Edge Functions Deno. Frontend statis di Cloudflare Pages; integrasi GitHub memakai repo privat. Build npm run build menghasilkan dist. Tidak memerlukan FastAPI/MongoDB untuk produksi pada desain ini.
Browser ↔ Supabase Auth/Postgres/Storage dengan JWT dan RLS. Browser → Edge Function AI (JWT terverifikasi) → endpoint resmi provider. Edge Function mengambil konteks dari versi yang diotorisasi, bukan mempercayai teks/proyek/role yang dikirim client. Keys provider hanya di Supabase secrets. Bila Emergent membuat backend default, beritahu target ini sejak prompt pertama agar tidak terjadi migrasi besar di tengah pekerjaan.
Aplikasi memakai polling 15 detik saat thread aktif dan invalidasi sesudah perubahan; tidak menambahkan Realtime dahulu. Permintaan AI per bab dibatasi 100 detik, satu eksekusi aktif per proyek; hasil besar ditangani per bagian. Tidak ada queue/worker panjang di MVP.

## Gratis dan biaya operasional

Target hosting frontend $0 pada Cloudflare Pages Free dalam kuota; free subdomain menghindari biaya domain. Supabase Free saat pemeriksaan: database 500 MB, storage 1 GB, egress 5 GB; pause setelah 1 minggu tidak aktif, tanpa automatic backup dan SLA uptime pada paket Free. Batas Edge Function Free 150 detik dan CPU 2 detik memotivasi ekstraksi PDF di browser. Batas kuota dapat berubah; periksa kembali ketika deploy.
Emergent production memiliki biaya kredit bulanan; preview tidur dan tidak menjadi hosting permanen. Karena itu produksi dirancang di luar Emergent. Ketersediaan ekspor GitHub mengikuti plan akun. Tidak ada biaya aplikasi untuk mahasiswa; owner dapat menanggung API terkontrol. Model frontier melalui API umumnya berbayar. Gemini memiliki free tier pada model tertentu, dengan batas dan ketentuan penggunaan data; jangan menganggap semua Gemini atau model Pro gratis.
Mode tanpa AI menyediakan bimbingan, diskusi, revisi, rubrik manual dan ekspor prompt. Pengguna boleh memakai AI eksternal secara manual kemudian mengimpor hasil terstruktur sebagai draft. Ini tidak meniadakan aturan privasi layanan yang mereka pilih. Tidak ada fallback otomatis ke provider berbayar.

## Kontrol kuota penyimpanan

Ilustrasi kapasitas: 20 mahasiswa × 5 versi × 5 MB = 500 MB PDF, sebelum sumber tambahan dan teks hasil ekstraksi. Versi 25 MB dapat menghabiskan 2.5 GB pada jumlah yang sama, sehingga batas file saja tidak cukup. Kuota per proyek default 35 MB; cadangan storage global 20%. Estimasi total 20×35=700 MB, bukan jaminan kuota provider.
Tampilkan kapasitas berdasarkan metadata dan rekonsiliasi lewat dashboard Supabase. Ketika kapasitas aplikasi mendekati batas, blokir upload baru dengan penjelasan; dosen mengarsipkan/unduh lalu menghapus versi lama secara eksplisit. Tidak menghapus otomatis bukti lama. Simpan link video; tidak menyimpan video di bucket.

## Alur dosen

Login → dashboard → pilih mahasiswa → buka versi naskah → tentukan rentang halaman bab → validasi hasil ekstraksi → review manual atau AI → inspeksi bukti → edit/terima temuan → publikasikan tindak lanjut → tetapkan target pertemuan berikutnya. AI findings tidak otomatis menjadi instruksi final. Dosen dapat menolak dan memberi alasan. Catatan privat disimpan di tabel terpisah. Dashboard menampilkan jumlah milestone/revisi, bukan persentase kualitas ilmiah yang tidak terdefinisi.

## Alur mahasiswa

Login email yang diizinkan → proyek sendiri → unggah PDF → tulis ringkasan perubahan → tentukan Bab I–V → lihat komentar/revisi → diskusi → kirim bukti perbaikan dengan versi dan halaman → tunggu verifikasi dosen. Mahasiswa boleh self-review hanya jika dosen mengaktifkan model/budget; default disabled pada shared paid key. Hasil self-review diberi label draft. Satu kartu menampilkan langkah berikutnya dan deadline sehingga tidak harus membaca seluruh dashboard.

## Desain layar dan kenyamanan

Navigasi global: Dashboard, Mahasiswa, Notifikasi, Pengaturan. Di proyek: Ringkasan, Naskah, Revisi, Diskusi, Target, Pertemuan. Dosen melihat filter status/bab/severity; mahasiswa melihat tugas terdekat. Desktop: PDF/kutipan di kiri dan komentar/temuan di kanan; mobile: pindah tab Naskah dan Review. PDF tidak dipaksa mengecil menjadi kolom sempit.
Palet biru gelap, teal dan latar terang; severity disertai label teks/ikon, bukan warna saja. Font minimum 14–16 px, tombol sentuh nyaman, keyboard focus, kontras dan pesan error yang menjelaskan tindakan berikutnya. Autosave draft dengan status tersimpan dan optimistic lock; toast hanya sesudah persistence berhasil. Empty/loading/error/offline state wajib. AI output disanitasi; tautan eksternal HTTPS, rel=noopener; tidak mengeksekusi HTML dari komentar/naskah.

## PDF, ekstraksi dan bukti

MVP menerima PDF berbasis teks. Gunakan PDF.js worker di browser untuk preview dan ekstraksi per halaman; simpan text + page index + hash. Minta pengguna memilih rentang halaman setiap bab karena TOC dan nomor Romawi membuat deteksi otomatis tidak selalu benar. Bedakan halaman PDF dan halaman tercetak; label cetak dapat diisi manual.
Tampilkan hasil ekstraksi dan minta konfirmasi sebelum AI review. Scan/teks kosong atau rusak menampilkan pilihan menempel teks per bab atau unggah PDF teks; tidak memanggil OCR diam-diam. Gambar/rumus/tabel yang tidak terbaca = Not assessed. Bab III diagram wajib pada rubrik, tetapi reviewer teks tidak boleh menyatakan diagram tidak ada hanya karena ekstraksi tidak memuatnya. Dosen dapat memeriksa visual manual pada PDF dan menyimpan keputusan. P1 menambahkan hanya halaman visual terpilih, bukan seluruh PDF.
Versi sealed setelah confirmed; perbaikan hasil ekstraksi membuat revision baru/hash baru agar cache tidak stale. Kegagalan upload/extraction mempunyai status dan retry terpisah. File di private bucket, signed URL singkat, akses dibuktikan dengan JWT/RLS. MIME dan ekstensi diperiksa; jangan gunakan public bucket.

## Aturan review dari toolkit

Import rule_engine.json v1 dengan 92 rule; simpan versi dan hash, tidak menulis ulang ID. Terapkan per profil: ML, software/SI, HCI, IoT, IR/RAG dan process mining; proposal membatasi IV–V menjadi N/A. Status Pass/Partial/Fail/Not assessed/N/A; severity Critical/Major/Minor/Review; confidence terpisah.
Kutipan dan locator harus cocok dengan halaman/konteks yang dikirim. Validator menolak locator di luar versi/context; kutipan tidak cocok ditandai unverified dan tidak boleh diterima sebagai bukti tanpa pemeriksaan dosen. Temuan absence menggunakan scope halaman dan deskripsi gap, bukan kutipan palsu. Sitasi–klaim dan indeks venue tidak diverifikasi otomatis. Status belum terverifikasi harus tampak di UI.
Skor dihitung kode dari dimension ratings 0–3 yang diterima dosen, bukan persentase dari LLM atau count rule gagal. Bobot bab/dimensi mengikuti toolkit. N/A dikeluarkan; Not assessed mengurangi cakupan; jangan tampilkan siap ujian berdasarkan skor. Bukti teks tidak boleh menghasilkan klaim telah menilai gambar.

## Pilihan model dan kredensial

Tiga adapter native: OpenAI Responses, Anthropic Messages, Gemini generateContent. Config model di model_catalog.json berisi model_id, provider, capability, max input/output, harga/tanggal verifikasi dan enabled flag. Model ID yang ditulis adalah seed dokumentasi 6 Oktober 2026, bukan jaminan akses akun; dosen menguji koneksi sebelum mengaktifkan. Model dapat berubah tanpa redesign frontend.
Untuk review rutin sediakan pilihan seimbang; frontier kualitas tinggi dipakai untuk metodologi/consistency sulit setelah pilot. Tidak mengklaim model tertentu terbaik pada skripsi sebelum evaluasi. Owner keys tersimpan di secrets OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY. UI menampilkan configured/not configured, bukan nilai key. Mahasiswa tidak melihat atau mengganti secret. Tidak memakai Emergent Universal Key. Tidak memasukkan key ke prompt/chat, localStorage, repo atau variabel VITE.
MVP memakai keys owner. BYOK tiap mahasiswa ditunda karena memerlukan penyimpanan terenkripsi, rotasi dan otorisasi tambahan. Dosen menentukan allowlist model per peran. Provider tidak dipilih berdasarkan model_id string yang tidak terpercaya. Tidak ada arbitrary base URL; batasi host pada tiga provider.

## Budget dan token API

Default AI_OFF sampai dosen mengaktifkan provider dan budget. Contoh budget aplikasi $5/bulan; kuota student disabled lalu dapat diatur 5 self-review/bulan, owner 40 review/bulan sesuai kebutuhan; angka adalah konfigurasi, bukan estimasi wajib. Hard limit di aplikasi hanya mengendalikan panggilan aplikasi ini; bukan billing limit akun provider.
Sebelum panggilan reserve biaya maksimum secara atomik, mempertimbangkan output termasuk reasoning, input margin, images jika nanti didukung; config harga wajib tersedia. Nilai usage aktual dicatat, reserve dikurangi sesuai actual jika tersedia; bila timeout/usage tidak diketahui pertahankan reserve hingga direkonsiliasi, jangan asumsikan gratis. Formula cost = Tin/1e6×Pin + Tout_billed/1e6×Pout + biaya tambahan. Untuk model dengan kebijakan token lain, adapter memasukkan detail native usage. Jika tidak mampu memberi batas konservatif, gunakan kuota jumlah panggilan dan tandai budget estimate, bukan hard monetary cap.
Review awal: max input 18,000 token terestimasi dan output cap 4,000 token termasuk batas reasoning yang didukung provider; pecah bab besar secara eksplisit, tampilkan subbagian yang tidak dikirim. AI tidak dipanggil pada setiap upload/refresh/chat dosen-mahasiswa. Chat AI memakai kutipan terpilih atau review tersimpan + maksimum 8 pesan, bukan seluruh histori skripsi.
Contoh hitungan OpenAI GPT-6.1 Sol pada tarif sumber: 12,000 input dan 3,000 output tertagih × $2/$10 per juta = $0.054/panggilan; 40 panggilan = $2.16. Ini simulasi aritmetika tanpa cache, tools, gambar atau token tambahan; bukan janji biaya naskah nyata.

## Eksekusi AI dan pemulihan

Edge Function melakukan auth.getUser/JWT verification, cek allowlist aktif, akses proyek, model whitelist, konteks versi, budget dan idempotency. Simpan run pending/running/succeeded/failed/unknown serta request id sebelum panggilan. Unique idempotency key dan atomic claim mencegah double submit; cache mencakup version hash, scope hash, rubric hash, prompt version dan model config hash serta tidak dibagi antarproyek.
Tidak meretry otomatis timeout ambigu karena provider mungkin sudah memproses dan menagih. 401/403 tampilkan perbaikan kredensial; 429 tampilkan Retry-After dan tombol coba lagi; 5xx perbolehkan retry manual dengan peringatan biaya ambigu. JSON invalid disimpan sebagai failed, tidak dianggap hasil sukses dan tidak mengubah tracker. Dosen dapat mengecilkan konteks tanpa kehilangan draft. Timeout 100s tetap menyisakan ruang di batas runtime Free; request yang melebihi harus dibagi. Tidak mengimplementasikan whole-thesis background agent di MVP.

## Diskusi, pertemuan dan sumber

Thread individu per proyek dan komentar pada finding/version. Tidak perlu instant chat WhatsApp-like; refresh ringan, unread badge dan reply cukup untuk pengguna sedikit. Catatan pertemuan dapat diedit dosen, mahasiswa membaca keputusan; usulan agenda mahasiswa terpisah di diskusi. Meeting URL manual; tidak mengirim undangan kalender/email otomatis. ICS diunduh dan diimpor pengguna. Sharing video/demo melalui URL. Notifikasi default hanya in-app; email/push dan grup menjadi P1.

## Keandalan, akses dan backup

RLS semua tabel proyek dan bucket; professor role tidak dapat diubah mahasiswa. Role/membership tidak berasal dari form/localStorage atau user_metadata yang editable. Invitation email dicocokkan dengan verified auth identity dan diklaim server, binding ke auth UID. Owner bootstrap dilakukan sekali lewat admin setup dari identity terverifikasi. Invite UI menambah allowlist, tidak memerlukan email delivery. OAuth user yang belum diizinkan tidak mendapat data dan tidak dapat mengklaim project.
Private notes tabel terpisah; student RLS tidak mengizinkan select/update/delete. Anonymous access ditolak. Derived records/jobs/source text/reviews/exports mengikuti policy akses yang sama. Service role hanya di fungsi admin terbatas; endpoint tetap cek auth dan project. Browser memakai publishable/anon key dengan RLS, bukan service role.
Ekspor metadata dan semua file proyek oleh dosen minimal tiap minggu dan sebelum migrasi; CSV revisi dan laporan saja tidak merupakan backup lengkap. JSON export tanpa secrets, file diunduh terpisah/ZIP dengan manifest hash. Restore maintenance script memakai service credentials hanya lokal; lakukan dry-run dan restore ke proyek uji, bukan otomatis menghapus database produksi. Kegagalan export ditampilkan; jangan tandai backup selesai bila file belum diunduh. Free tier tidak memberi jaminan uptime; sediakan prosedur resume Supabase dan copy dokumen asli di luar aplikasi.

## Prioritas pembangunan dan kredit

Checkpoint A: plan/arsitektur, target 4 kredit. Checkpoint B: Auth, RLS, proyek, dashboard, target 12. Checkpoint C: PDF, versi, diskusi, revisi, milestone, target 10. Checkpoint D: adapter API, review per bab, chat konteks, traceability, target 10. Checkpoint E: acceptance, ekspor, deployment guide, target 7. Cadangan blocker 7. Total pagu rencana 50. Ini alokasi kerja yang diusulkan, bukan harga resmi per fitur.
Setiap checkpoint memakai prompt yang sudah disiapkan; upload specification dan rules sebelum build; minta patch, bukan regenerasi aplikasi. Uji blocker segera ketika modul dibuat agar tidak menghabiskan cadangan di akhir. Perbaikan kosmetik dibatasi satu putaran. Scope grup, email, OCR, vector/RAG dan auto-index tidak boleh muncul tanpa revisi anggaran.

## Persiapan akun dan deploy

1. Siapkan Supabase Free dan Google OAuth; daftar redirect URLs development/production yang benar. 2. Tetapkan verified owner email dan invite mahasiswa melalui allowlist. 3. Masukkan publishable config frontend dan keys provider hanya di server secrets. 4. Upload SDD, rule_engine.json, master_prompt.txt dan model_catalog.json ke Emergent. 5. Jalankan prompts A–E bertahap dengan pengukuran usage.
6. Simpan kode ke GitHub privat bila plan mendukung. 7. Jalankan migrations dan Edge Functions pada Supabase yang sama, periksa RLS dan bucket. 8. Deploy frontend Cloudflare Pages: root yang berisi package.json, npm run build, output dist; frontend env hanya URL dan publishable key. SPA fallback/refresh routes harus diuji. 9. Tambahkan production OAuth redirect dan allowed origins Edge Functions. 10. Jalankan acceptance dengan dosen dan dua mahasiswa uji, lalu undang pengguna nyata.
Tidak mengunggah API keys/data mahasiswa ke repo. Tidak mengasumsikan tombol Publish Emergent men-deploy Supabase atau Cloudflare. Kebutuhan akses akun/secret hanya dilakukan ketika pembangunan aktual; paket ini tidak membuat akun atau deploy apa pun.

## Kriteria selesai

Aplikasi dinyatakan MVP selesai bila dua pengguna mahasiswa tidak dapat mengakses data satu sama lain; dosen dapat meninjau kedua proyek; unggah dan versi tersimpan setelah refresh; komentar, revisi dan milestone berjalan; hanya dosen menutup revisi; manual mode berjalan tanpa keys; model selector dan minimal satu paid/free provider yang benar-benar dikonfigurasi lulus live smoke test; adapter lainnya lulus mocked contract dan status belum live-verified ditampilkan. Semua tiga provider harus live diuji sebelum diklaim seluruh integrasi selesai.
PDF scan tidak menyebabkan false review, cache idempotency tidak menghasilkan biaya berulang untuk klik yang sama, output JSON invalid tidak mengubah data, budget concurrency dan private notes lulus test, backup dan restore contoh lulus. Checkpoint credit aktual tidak melebihi pagu; bila pagu habis sebelum acceptance, status belum selesai dinyatakan dengan jelas.

## Sumber dan batas pengetahuan

Sumber primer diperiksa 6 Oktober 2026; daftar URL terlampir. Tarif, model ID, kuota dan plan dapat berubah. Rancangan tidak membuktikan konsumsi 50 kredit atau kualitas review model sebelum build/pilot. Toolkit asal sudah dibaca; 92 aturan dipertahankan. Produk ini dapat menjadi aplikasi pribadi dahulu, kemudian produk komersial setelah validasi dan peninjauan ketentuan layanan.

## Daftar fitur

| Prioritas | Fitur | Implementasi |
|---|---|---|
| P0 | Login dan akses | Google OAuth; allowlist undangan; satu dosen owner; setiap mahasiswa hanya proyek sendiri. |
| P0 | Dashboard dosen | Daftar mahasiswa, tahap TA, kiriman menunggu review, revisi prioritas, deadline, aktivitas terakhir dan filter. |
| P0 | Ruang bimbingan | Ringkasan TA, Bab I–V, naskah, revisi, diskusi, target dan catatan pertemuan. |
| P0 | Naskah dan versi | PDF teks maksimum 25 MB; default anjuran <5 MB; versi immutable; preview dan ekstraksi per halaman di browser. |
| P0 | Komentar | Komentar per bab/halaman dan balasan kronologis; dosen dapat membuat catatan privat. |
| P0 | Tracker revisi | Open → In progress → Submitted → Verified closed/Reopened; hanya dosen mengesahkan penutupan. |
| P0 | Milestone | Proposal, pengumpulan data, implementasi, eksperimen, naskah akhir; checklist dan deadline. |
| P0 | Catatan pertemuan | Tanggal, agenda, keputusan, target berikutnya; tautan Meet/Zoom serta ekspor ICS sederhana. |
| P0 | Berbagi sumber dan demo | Tautan paper, repositori, demo dan video; HTTPS dengan label; berkas PDF pendukung dalam kuota. |
| P0 | AI review per bab | 92 aturan toolkit dipilih sesuai bab/profil/tahap; bukti dan locator, severity/confidence, rekomendasi dan draft findings. |
| P0 | AI dialog kontekstual | Tanya tentang kutipan yang dipilih atau hasil review tersimpan; bukan seluruh repositori dokumen otomatis. |
| P0 | Keterlacakan penelitian | Matriks tujuan→teori→metode→evaluasi→hasil→kesimpulan yang diedit manual; AI membantu pada konteks yang dipilih. |
| P0 | Pengaturan model dan biaya | Provider/model dropdown, test koneksi oleh dosen, budget aplikasi, token, penggunaan dan disable AI. |
| P0 | Notifikasi dan ekspor | Badge dalam aplikasi, unread diskusi dan due soon; CSV revisi; JSON backup metadata; laporan print-to-PDF. |
| P1 | Peningkatan setelah pilot | Gambar halaman terpilih ke vision, DOCX import, text diff, chat grup, email reminder, pencarian sumber. |
| P2 | Di luar anggaran awal | Video call native, OCR seluruh skripsi, verifikasi Scopus/WoS otomatis, autonomous multi-agent, vector database, mobile native, payment. |

## Referensi primer

- Emergent: publishing dan minimum kredit: https://help.emergent.sh/deployment-types
- Emergent: cara konsumsi kredit: https://help.emergent.sh/how-credits-work-basics
- Emergent: GitHub: https://emergent.sh/glossary/github-integration
- Cloudflare Pages: batas layanan: https://developers.cloudflare.com/pages/platform/limits/
- Supabase: biaya, kuota dan pause: https://supabase.com/pricing
- Supabase: batas Edge Functions: https://supabase.com/docs/guides/functions/limits
- Supabase: Google login: https://supabase.com/docs/guides/auth/social-login/auth-google
- OpenAI: model dan tarif: https://developers.openai.com/api/docs/models
- OpenAI: Responses: https://developers.openai.com/api/reference/responses/overview
- Claude: model: https://platform.claude.com/docs/en/models/overview
- Claude: Messages: https://platform.claude.com/docs/en/api/messages/create
- Gemini: model: https://ai.google.dev/gemini-api/docs/models
- Gemini: harga dan penggunaan data: https://ai.google.dev/gemini-api/docs/pricing
- Gemini: generateContent: https://ai.google.dev/api/generate-content
