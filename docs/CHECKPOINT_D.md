# Checkpoint D — AI, rubrik dan keterlacakan

Dibangun di Codex dari main 13a2551, 8 Oktober 2026. Tidak memakai kredit atau deployment Emergent. **Migrasi 0009 dan Edge Function sudah diterapkan ke Supabase dev; acceptance hosted tahap D belum lengkap. AI tetap nonaktif dan provider belum diuji live.** Hasil lokal di bawah tetap terpisah dari hasil hosted.

## Status hosted — 9 Oktober 2026

- Sembilan migrasi diterapkan; RLS dan ACL RPC service-only diperiksa. Fungsi memakai Auth getUser dan pemeriksaan membership/proyek; gateway legacy JWT nonaktif sesuai persetujuan pengguna.
- Preview branch: https://codex-checkpoint-d.bimbing-ta.pages.dev/. Login Google pembimbing nyata, persistensi sesi, status AI terautentikasi (POST 200/OPTIONS 204), rubrik dan bobot diperiksa. Origin preview exact diizinkan; origin produksi belum diaktifkan untuk fungsi D.
- Undangan mahasiswa dan proyek RAG pertama dibuat atas instruksi pembimbing, dengan lima milestone dan satu baris keterlacakan draft. Metadata JSON dan ZIP tanpa PDF berhasil diekspor; CRC serta hash manifest cocok.
- Konflik catatan privat dari dua tab owner nyata ditolak pada sesi yang memakai versi lama. Muat versi terbaru berhasil; teks uji dikembalikan ke isi kosong semula.
- Perbaikan editor mempertahankan nilai setelah mengubah record keterlacakan, revisi, pertemuan dan sumber; hanya formulir record baru yang direset. Regresi UI lokal membuktikan catatan tetap bertahan setelah simpan/reload dan edit kolom lain; uji tersebut memakai persona sintetis, bukan Supabase hosted.
- Belum diuji: login/hak akses mahasiswa nyata, alur PDF hosted, konkurensi ledger AI hosted, provider live dan restore. Tidak ada panggilan AI berbayar. PR #2 tetap draft dan main produksi tetap checkpoint C.

## Yang tersedia

- Tab Asisten AI: review bab, dialog menggunakan kutipan/review milik peminta, dan saran keterlacakan. Konteks berasal dari versi terkunci dan rentang bab terkonfirmasi di database. Pertanyaan memakai paling banyak delapan pesan terdahulu dalam thread milik peminta.
- Persetujuan proyek per pengguna dengan pilihan provider dan jenis data; dapat dicabut untuk permintaan berikutnya. Pratinjau menampilkan teks/konteks persis, halaman yang tidak ikut diperiksa, batas input konservatif dan estimasi reservasi. File PDF, identitas pengguna, catatan privat, link eksternal dan diskusi manusia tidak dikirim.
- Tiga adapter native: OpenAI Responses (store:false), Anthropic Messages (output_config.format), Gemini generateContent (responseJsonSchema). Endpoint resmi tetap, tanpa tools, web research, retry otomatis atau fallback provider.
- Pengaturan model, tier, tarif, kemampuan, uji live, aktivasi per model, izin mahasiswa dan anggaran per bulan. Model baru dan AI default nonaktif. Perubahan kemampuan/tarif/cap membatalkan hasil uji. Kunci provider hanya pada Supabase Secrets.
- Gemini hanya menerima konfigurasi **thinkingBudget yang dibatasi dan didukung model**. Model yang hanya mendukung thinkingLevel belum tersedia pada adapter ini. Batas respons + thinking direncanakan tidak melebihi batas output terkonfigurasi (maksimum 4.000); usage aktual menyertakan thoughtsTokenCount. Periksa dokumentasi model dan uji live sebelum aktivasi.
- RPC service-only ai_claim mengunci anggaran bulanan sebelum reservasi. Satu run aktif per proyek, idempotency global dengan cek peminta/proyek/konteks, serta cache per peminta/proyek/versi/rubrik/prompt/konfigurasi model. Cache tidak menambah reservasi atau menghasilkan temuan duplikat.
- Timeout maksimal 100 detik. Hasil yang belum pasti/worker terputus menjadi unknown dan biaya tetap ditahan. Tidak ada retry yang mungkin menagih dua kali. Usage diketahui direkonsiliasi dengan tarif snapshot; tanpa usage reservasi tidak dikembalikan otomatis.
- JSON, rule ID, dimensi, halaman asli, dan kutipan diperiksa. Kutipan palsu/locator salah serta klaim inspeksi visual atau indeks sumber tidak siap diterima. Gap memakai lingkup pemeriksaan yang eksplisit. Aturan tanpa bukti muncul sebagai Not assessed.
- Temuan AI tetap draf, dapat diubah/ditolak dosen. Persetujuan melalui RPC owner-only membuat revisi terbuka, mempertahankan original_ai, dan mencatat audit. Mahasiswa tidak dapat menyetujui/menutup revisi. Skor hanya dihitung oleh kernel toolkit dari dimensi yang disetujui dosen.
- Keterlacakan manual dengan draf persisten dan optimistic lock. Saran AI disimpan sebagai ai_suggestion/draft dengan versi/lingkup sumber; hanya dosen memverifikasi. Export metadata mencakup AI dan keterlacakan yang diizinkan RLS.
- Ekspor prompt dari teks/rubrik terpilih tetap berfungsi tanpa provider key. Impor hasil AI eksternal otomatis belum tersedia; pembimbing dapat mencatat revisi manual setelah memeriksa hasil eksternal.

## Aktivasi hosted (urutan untuk setup baru)

Pada proyek dev saat ini langkah migrasi dan deployment fungsi sudah selesai; jangan menerapkan ulang atau mereset data. Langkah provider/model berikut masih tertunda dan memerlukan kesepakatan sebelum panggilan berbayar.

1. Simpan kode branch D, review, dan pertahankan main produksi sampai konfigurasi hosted siap. Backup data yang sudah ada; **jangan jalankan suite persona empty-DEV pada proyek yang kini memiliki akun pembimbing nyata**.
2. Jalankan runner migrasi read-only `node scripts/hosted-migrate.mjs`. Delapan migrasi lama harus cocok dan hanya `20261008000009_ai_execution.sql` tertunda. Terapkan dengan `--apply --confirm-ref=tghcovjdsxirhpexpqor` tanpa reset dan tanpa reseed rubrik/bobot pengguna. Admin env hanya lokal/Secrets, bukan GitHub source.
3. Deploy fungsi dari direktori repo dengan Supabase CLI resmi yang sudah diautentikasi:
   ```sh
   supabase functions deploy ai --project-ref tghcovjdsxirhpexpqor
   ```
   `supabase/config.toml` memakai verify_jwt=false karena publishable key bukan JWT. **Fungsi wajib tetap menggunakan Auth getUser untuk bearer pengguna dan pemeriksaan membership/proyek di service.ts**; tidak boleh menghapus pemeriksaan ini. Service RPC tidak bisa dipanggil oleh anon/authenticated.
4. Di Supabase Edge Functions → Secrets, isi satu key pilihan: OPENAI_API_KEY, ANTHROPIC_API_KEY atau GEMINI_API_KEY. Isi ALLOWED_ORIGINS dengan origin Cloudflare sebenarnya, dipisahkan koma jika lebih dari satu. Tidak memakai wildcard atau URL berpath. AI_TIMEOUT_MS opsional, maksimum 100000. Nilai SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY memakai secret bawaan runtime; jangan pindahkan ke frontend.
5. Deploy frontend melalui Cloudflare Pages/GitHub setelah backend siap. Tetap `yarn build`, output `dist`, NODE_VERSION=22.23.3, YARN_VERSION=1.22.22, dan dua VITE_SUPABASE_* publik. Tambahkan origin ke OAuth redirect sesuai konfigurasi C.
6. Masuk sebagai pembimbing. Di Pengaturan, tambah model dengan ID API dan tarif yang diperiksa pada provider. Catalog lama hanya contoh, bukan jaminan akses/tarif terkini. Simpan anggaran bulan berjalan; izinkan AI, mahasiswa tetap nonaktif terlebih dahulu.
7. Pilih proyek, klik **Uji koneksi live** dan konfirmasikan panggilan kecil tanpa naskah. Jika berhasil, aktifkan model. Status ok terikat ke hash konfigurasi; mengubahnya memerlukan uji ulang.
8. Pada Asisten AI proyek, simpan persetujuan, pilih halaman, lihat pratinjau lalu kirim satu review kecil. Verifikasi usage, hasil draf, kutipan, persetujuan revisi dan penilaian. Baru setelah itu tentukan izin/kuota mahasiswa. Semua mahasiswa harus menyimpan persetujuan sendiri.

## Anggaran dan rekonsiliasi

Reservasi memakai tarif input × max_input_tokens + tarif output × min(max_output_tokens,4000), dibulatkan ke atas. Konteks ditolak jika byte UTF-8 prompt/data/schema + margin 1024 melebihi min(max_input_tokens,18000); ini sengaja konservatif dan tidak memotong diam-diam. Angka tidak menggantikan tokenizer/tagihan provider. Tarif harus benar untuk seluruh kisaran yang dipakai; tidak memakai cache diskon/tools/gambar. Jika biaya aktual melampaui reservasi, biaya aktual tetap dicatat dan panggilan berikutnya dihentikan saat pagu tercapai. Batas ini hanya untuk aplikasi ini, bukan hard billing limit akun provider.

`held`/`unknown` tetap masuk biaya dan jumlah panggilan sampai tersedia bukti penggunaan. Rekonsiliasi unknown dilakukan admin melalui SQL setelah memeriksa request ID/tagihan provider: perbarui actual_cost dan status=reconciled dengan bukti audit yang memadai. Jangan melepaskan reservasi hanya karena respons timeout. Tidak ada tombol refund otomatis atau provider billing API di MVP.

## Validasi lokal

- `yarn typecheck` dan `yarn typecheck:edge`: frontend dan core/adapters/service TypeScript; entrypoint npm/Deno tetap perlu validasi deployment runtime hosted.
- `yarn build`: TypeScript + Vite production bundle.
- `yarn test:ai`: kontrak tiga provider dan SQL execution ledger, Auth/provider tiruan, PostgreSQL WASM nyata. Memeriksa ACL, bukti, idempotency, cache, anggaran, usage unknown, keputusan/audit, pembatalan uji model dan consent.
- `yarn test:workspace`: regresi 27 pemeriksaan A/B/C serta serializer menggunakan SQL/WASM.
- `yarn test:score`: empat pemeriksaan kernel/bobot toolkit.

UI lokal desktop/mobile diuji melalui `node tests/workspace/ui.mjs` dengan Auth/Storage tiruan dan SQL PostgreSQL WASM, termasuk PDF, revisi, pertemuan, sumber, ekspor dan regresi editor keterlacakan. Acceptance hosted terbatas pada daftar di bagian status hosted di atas. Hasil mocked provider tidak boleh diberi label live-tested. Runner hosted lama hanya menguji A/B/C; kelulusan historis 22/22 bukan kelulusan D. Checkpoint E adalah acceptance hosted lengkap, perbaikan blocker dan backup/restore, sesudah konfigurasi D tersedia.

## Referensi kontrak (dibuka 8 Oktober 2026)

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/your-data
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/thinking
- https://supabase.com/docs/guides/functions/auth
