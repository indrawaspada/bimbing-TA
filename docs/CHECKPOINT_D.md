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

Pada proyek dev saat ini langkah migrasi dan deployment fungsi sudah selesai; jangan menerapkan ulang atau mereset data. Urutan berikut adalah referensi setup baru atau upgrade dari C, bukan daftar yang perlu diulang pada dev saat ini. Langkah provider/model masih tertunda; AI tetap nonaktif sampai pengguna secara eksplisit mengizinkan aktivasi dan uji live.

1. Simpan kode branch D, review, dan pertahankan main produksi sampai konfigurasi hosted siap. Backup data yang sudah ada; **jangan jalankan suite persona empty-DEV pada proyek yang kini memiliki akun pembimbing nyata**.
2. Jalankan runner migrasi read-only `node scripts/hosted-migrate.mjs`. Pada upgrade dari C, delapan migrasi lama harus cocok dan hanya `20261008000009_ai_execution.sql` tertunda. Pada dev saat ini, sembilan migrasi seharusnya cocok dan tidak ada yang tertunda. Terapkan hanya migrasi yang terbukti belum ada, dengan konfirmasi ref target, tanpa reset dan tanpa reseed rubrik/bobot pengguna. Admin env hanya lokal/Secrets, bukan GitHub source.
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

### Pemeriksaan lanjutan lokal — 9 Oktober 2026

Basis revalidasi: branch `codex/checkpoint-d`, commit `faa5d1c`, ditambah perbaikan editor mobile dan portabilitas Windows. Windows, Node **24.15.0**, Yarn Classic **1.22.22**, Edge headless terpasang. Instalasi frozen lockfile selesai tanpa perubahan `yarn.lock` dan tanpa mengabaikan engine.

- Build produksi (termasuk TypeScript frontend) dan `typecheck:edge` lulus; regresi workspace **27/27**, AI **14/14** dengan provider mock, dan skor **4/4** lulus.
- Regresi UI lengkap lulus: simpan/reload/edit kolom lain mempertahankan catatan keterlacakan; PDF lokal, draft, diskusi, keputusan pertemuan, lifecycle revisi, sumber, CSV/ZIP dengan dua PDF, serta penghentian polling tetap lulus. Auth dan Storage seluruhnya sintetis, SQL PostgreSQL WASM disposable; ini bukan acceptance hosted.
- Editor record memakai seluruh lebar tabel di desktop. Pada viewport mobile, formulir dibatasi ke lebar layar agar input dan tombol simpan tidak terpotong; tabel tetap dapat digulir horizontal. Pemeriksaan geometri pada **1280, 390 dan 320 px** dan inspeksi screenshot lulus. Screenshot lokal ada di `dist-harness/qa/traceability-{1280,390,320}.png` (git-ignored).
- Harness UI menerima `BIMBINGTA_UI_BROWSER` untuk executable Chromium terpasang pada Windows/macOS; fallback Chromium Linux tetap tersedia. Path hasil build memakai `fileURLToPath`.
- Pemeriksaan entrypoint seed diperbaiki untuk path Windows. `.gitattributes` menjaga LF pada rubrik, prompt, migrasi dan skrip SQL hosted yang di-hash. Byte sumber tersebut diperiksa identik dengan Git; hash rubrik/prompt kembali cocok dengan catatan historis. Tidak ada perubahan isi migrasi atau reseed database hosted.
- Pemeriksaan HTTP read-only sebelum publikasi perbaikan mobile: HTML dan aset keterlacakan preview Cloudflare **200**. Aset `TraceabilityTab-tU_JEV-q.js` sudah memuat editor lintas lima kolom, tetapi saat itu belum memuat pembatas lebar mobile. Pemeriksaan aset bukan uji UI terautentikasi dan bukan bukti seluruh deployment identik dengan HEAD.
- `.env.local` dan `.secrets/admin.env` tidak tersedia, serta tidak ada sesi browser hosted yang terhubung. Acceptance mahasiswa nyata, PDF hosted, ledger concurrency hosted, provider live dan restore tetap tertunda. AI tetap nonaktif; revalidasi lokal tidak menjalankan panggilan provider nyata atau migrasi hosted.

Pembacaan [PR #2](https://github.com/indrawaspada/bimbing-TA/pull/2) pada 9 Oktober mengonfirmasi draft dari `codex/checkpoint-d` ke `main`, head `faa5d1c`, dengan pemeriksaan Cloudflare Pages sukses. Deskripsi PR mencatat uji hosted terdahulu: catatan keterlacakan bertahan sesudah simpan/reload dan muncul dalam metadata ekspor. Bukti tersebut merupakan laporan sesi sebelumnya, bukan pengujian ulang pada sesi Windows ini.

### Publikasi preview — 9 Oktober 2026

Commit implementasi `e240a7f13befe6eb3d6b3ecbcea2962d212aa7d5` (`Fix mobile traceability editor and Windows validation`) dipush ke `codex/checkpoint-d`. [Pemeriksaan Cloudflare Pages](https://dash.cloudflare.com/?to=/c6c9b2e1c1e03350d43b23942205ef7d/pages/view/bimbing-ta/60cbc0a1-1ec4-4b47-a17b-d1465f981091) **SUCCESS**, selesai **9 Oktober 2026 06:12:23 WIB** (8 Oktober 23:12:23 UTC).

- Preview tetap https://codex-checkpoint-d.bimbing-ta.pages.dev/; HTML, JavaScript keterlacakan dan CSS merespons **200**.
- HTML memuat `index-WatuRAFn.js`; aset `TraceabilityTab-B2yka3gI.js` memuat editor lintas lima kolom dan pembatas viewport mobile. CSS `index-DxI8wPzy.css` memuat aturan `max-width:calc(100vw - 3.5rem)`.
- GET rute statis `/proyek/static-route-check/keterlacakan` mengembalikan **200** dan index yang sama. Ini membuktikan fallback routing Pages, bukan akses proyek, login atau RLS.
- Deskripsi PR #2 diperbarui dengan perubahan dan validasi terbaru; PR tetap **open/draft** ke `main`. Main remote tetap `13a2551bd732bd061aa5432002ea7aa7694d83b6`, checkpoint C; tidak ada merge atau publikasi D ke produksi.
- Publikasi hanya frontend preview melalui integrasi GitHub/Cloudflare. Tidak ada deployment Emergent, reset/reseed/migrasi Supabase, perubahan izin/model/budget, atau panggilan provider AI. AI tetap nonaktif.

Pekerjaan lanjutan: review PR dan verifikasi tampilan editor pada sesi hosted terautentikasi; jalankan acceptance manual dengan akun pembimbing/mahasiswa nyata, PDF uji dan backup/restore proyek uji. Pengujian/aktivasi provider menunggu izin eksplisit pengguna. Gunakan data yang sudah ada dengan hati-hati; workflow empty-DEV historis tetap tidak sesuai untuk dev saat ini. Pemeriksaan aset dan build di atas tidak menutup acceptance hosted yang masih tertunda.

## Referensi kontrak (dibuka 8 Oktober 2026)

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/your-data
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/thinking
- https://supabase.com/docs/guides/functions/auth
