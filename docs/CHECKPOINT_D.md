# Checkpoint D — AI, rubrik dan keterlacakan

Dibangun di Codex dari main 13a2551, 8 Oktober 2026. Tidak memakai kredit atau deployment Emergent. **Migrasi sampai 0010 dan Edge Function sudah diterapkan ke Supabase dev; acceptance hosted tahap D belum lengkap. AI tetap nonaktif dan provider belum diuji live.** Hasil lokal di bawah tetap terpisah dari hasil hosted.

## Status hosted — 9 Oktober 2026

- Sepuluh migrasi diterapkan, termasuk perbaikan guard rubrik/prompt 0010; audit native ulang cocok dengan sumber untuk seluruh hash migrasi, 28 tabel RLS, 56 fungsi, 62 policy dan 47 trigger. Fungsi memakai Auth getUser dan pemeriksaan membership/proyek; gateway legacy JWT nonaktif sesuai persetujuan pengguna.
- Preview branch: https://codex-checkpoint-d.bimbing-ta.pages.dev/. Login Google pembimbing nyata, persistensi sesi, status AI terautentikasi (POST 200/OPTIONS 204), rubrik dan bobot diperiksa. Origin preview exact diizinkan; origin produksi belum diaktifkan untuk fungsi D.
- Undangan mahasiswa dan proyek RAG pertama dibuat atas instruksi pembimbing, dengan lima milestone dan satu baris keterlacakan draft. Metadata JSON dan ZIP tanpa PDF berhasil diekspor; CRC serta hash manifest cocok.
- Konflik catatan privat dari dua tab owner nyata ditolak pada sesi yang memakai versi lama. Muat versi terbaru berhasil; teks uji dikembalikan ke isi kosong semula.
- Perbaikan editor mempertahankan nilai setelah mengubah record keterlacakan, revisi, pertemuan dan sumber; hanya formulir record baru yang direset. Regresi UI lokal membuktikan catatan tetap bertahan setelah simpan/reload dan edit kolom lain; uji tersebut memakai persona sintetis, bukan Supabase hosted.
- Belum diuji hosted: login/hak akses mahasiswa nyata, alur PDF/Storage API, konkurensi melalui Supabase/Edge, provider live dan restore file lengkap. Konkurensi SQL PostgreSQL 17 terpisah lulus 11 tes di CI; restore SQL hosted dengan ZIP sintetis dan rollback lulus dua kasus. Bukti ini terpisah dari acceptance API/live di bawah. Tidak ada panggilan AI berbayar. PR #2 tetap draft dan main produksi tetap checkpoint C.

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
2. Jalankan runner migrasi read-only `node scripts/hosted-migrate.mjs`. Pada upgrade dari C, delapan migrasi lama harus cocok; migrasi ledger `20261008000009_ai_execution.sql` dan guard `20261009000010_versioned_content_guard.sql` tertunda. Pada dev saat ini, sepuluh migrasi harus cocok dan tidak ada yang tertunda. Runner memvalidasi URL/DB terhadap ref dev yang ditetapkan serta hash SQL seluruh migrasi yang tercatat. Terapkan hanya migrasi yang terbukti belum ada, dengan konfirmasi ref target, tanpa reset dan tanpa reseed rubrik/bobot pengguna. Admin env hanya lokal/Secrets, bukan GitHub source.
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

## Rehearsal restore lokal — 9 Oktober 2026

Bagian awal checkpoint E: `scripts/restore-backup.mjs` memeriksa ZIP hasil ekspor aplikasi dan menjalankan restore sementara ke PostgreSQL WASM baru di memori. Tidak ada koneksi hosted, pembacaan kredensial admin/provider, opsi apply, perubahan migrasi, atau penonaktifan trigger/RLS. Seluruh fixture di-rollback, diperiksa kosong, lalu database ditutup.

```sh
yarn test:restore
node scripts/restore-backup.mjs backups/proyek-backup.zip --report=backups/restore-report.json
```

Folder laporan harus sudah ada dan nama file laporan harus belum dipakai; runner menolak overwrite. Input harus ZIP lengkap dengan metadata dan manifest, bukan Metadata JSON saja. Ukuran ZIP dan total hasil dekompresi dibatasi 128 MiB, metadata 64 MiB, PDF 25 MiB per file. Isi PDF diperlakukan sebagai byte; validasi hash bukan parsing/inspeksi visual atau pemindaian malware.

- SHA-256 metadata dan setiap PDF diperiksa; path ZIP, duplikasi, ukuran, daftar file dan versi yang gagal upload divalidasi sebelum import. Tabel hanya boleh berada di proyek sumber. Snapshot halaman/bab terkunci dihitung ulang oleh SQL dan harus cocok.
- Proyek, identitas mock owner/student, undangan mock, versi, halaman, rentang bab, revisi/bukti, komentar/balasan, pertemuan, sumber HTTPS, milestone dan keterlacakan dipetakan ke UUID baru. ID pengguna tidak boleh berasal dari ID versi/entitas lain; persetujuan/penutupan revisi tetap terikat ke owner. Locator dan bukti harus menunjuk versi serta halaman yang diekspor. Teks bebas tidak ditulis ulang.
- File PDF disimpan dan diverifikasi sebagai byte di memori; metadata Storage lokal mengikuti path proyek/versi baru. Auth dan Storage bukan layanan Supabase nyata. Tanggal pembaruan dan counter optimistic lock mengikuti trigger target; timestamp konfirmasi dan snapshot sumber dipertahankan. Audit baru hanya menandai rehearsal, bukan merekonstruksi audit lama.
- Scope yang didukung: ZIP proyek manual, termasuk proyek tanpa PDF/mahasiswa belum terhubung, record upload gagal tanpa file, serta nomor urut versi berlubang setelah penghapusan. Nomor asli dipertahankan (maksimum **2048**); nomor tidak valid atau duplikat ditolak. Histori AI (`ai_runs/messages/ratings`, temuan atau saran AI), lampiran sumber lama, serta upload ambigu belum didukung dan **ditolak**, tidak dilewati diam-diam.
- Catatan privat, draf, akun/login/undangan asli, audit lama, consent, rubrik/bobot pengguna, model, budget dan ledger biaya tidak masuk scope restore. Rehearsal memakai seed toolkit lokal dan identitas `example.test` hanya untuk memeriksa skema/relasi. Ini bukan backup lengkap workspace atau prosedur pemulihan produksi.
- **22/22 tes restore lulus** (runner awal 17/17): relasi/proof/snapshot/rollback, data rusak, path/ukuran/duplikasi ZIP, scope proyek, jenis ID, locator, format C, proyek tanpa PDF, upload gagal, penolakan data tak didukung, CLI tanpa apply dan laporan tanpa overwrite/konten naskah. Lanjutan mencakup gap/versi awal yang terhapus, kuota tepat penuh, nomor versi tidak valid/duplikat/melebihi batas, dan hubungan page ID/versi/index locator.
- Untuk mempertahankan nomor seperti v1/v4, runner membuat penanda `upload_failed` sementara tanpa PDF di transaksi SQL privat, lalu menghapus **hanya UUID penanda yang dibuatnya** sebelum mengimpor relasi dan memvalidasi hasil. Definisi `app.versions_guard()` diuji identik, trigger tetap aktif, nomor versi berikutnya tetap v5, dan tidak ada penanda/PDF tambahan dalam hasil akhir. Ini mekanisme rehearsal lokal saja; tidak dijalankan pada Supabase nyata.
- Page ID di locator harus berasal dari versi yang dinyatakan dan cocok dengan indeks halaman PDF. Locator temuan tidak boleh mengarahkan ke versi lain dari `finding.version_id`. Refusal ini mencegah referensi bersilang yang tidak terikat FK pada JSON.
- Suite UI lengkap lulus dan ZIP yang benar-benar dibuat oleh aplikasi berhasil direhearsal: **2 PDF, 1 revisi, 1 komentar, 1 pertemuan, 1 sumber, 1 baris keterlacakan**. CLI terbaru juga lulus ulang pada ZIP tersebut. Artefak sintetis lokal: `dist-harness/qa/workspace-backup.zip` dan `restore-report.json` (git-ignored). JSON laporan memuat `rollback_verified:true`, `hosted_tested:false`, `ai_enabled:false`, jumlah record/file, jumlah gap yang dipertahankan/penanda yang dibersihkan dan batas, bukan konten naskah atau identitas sumber.

B01/B02 lokal ini menambah bukti validasi, bukan kelulusan restore hosted. Acceptance mahasiswa/PDF nyata, restore maintenance ke Supabase uji, histori AI/ledger dan provider live tetap tertunda. AI tetap nonaktif. Untuk penulisan restore hosted kelak, target dan pemetaan pengguna harus eksplisit serta data lama tidak ditimpa; runner saat ini sengaja hanya menyediakan rehearsal lokal.

## Hosted publik read-only — 9 Oktober 2026

Commit rehearsal `521cf124637a99635ff78b30fc9a0e90c0fbdfda` dipush ke branch D; [Cloudflare Pages](https://dash.cloudflare.com/?to=/c6c9b2e1c1e03350d43b23942205ef7d/pages/view/bimbing-ta/3b095865-c30c-4ee3-a616-bb4bbefb3467) **SUCCESS**, selesai **06:58:52 WIB** (8 Oktober 23:58:52 UTC). PR #2 tetap draft, main tetap `13a2551`; runner restore hanya tool lokal, bukan endpoint atau fitur restore di frontend.

Pada **07:01:59 WIB** (00:01:59 UTC), tujuh pemeriksaan HTTP publik pada dev `tghcovjdsxirhpexpqor` **7/7 lulus**. Request menggunakan publishable config dari aset frontend yang sudah publik, tanpa login/JWT pengguna, kredensial admin, fixture, atau operasi provider. Nilai key tidak dicatat di repo/laporan.

| Pemeriksaan | Hasil |
| --- | --- |
| Anonymous REST `projects?select=id` | **401 / 42501**, tidak ada baris data |
| Anonymous REST `app_config?select=id` | **401 / 42501**, tidak ada baris data |
| Public Auth settings | **200**; Google ON, Email ON, global signup ON |
| AI OPTIONS dengan origin preview exact | **204**, allow-origin sama dengan `https://codex-checkpoint-d.bimbing-ta.pages.dev` |
| AI POST status tanpa bearer | **401 / unauthorized** |
| AI POST status dengan bearer palsu | **401 / unauthorized** |
| AI OPTIONS origin `https://rejected-origin.example.test` | **403 / origin_not_allowed**, tanpa allow-origin |

Settings Auth publik tidak membuktikan kebijakan membership aplikasi atau login pengguna. Email masih aktif di dev sebagaimana inspeksi historis C; panduan menonaktifkan Email untuk produksi tetap belum ditutup oleh pemeriksaan ini. Global signup ON dibutuhkan untuk login OAuth pertama sesuai setup yang ada. Tidak ada pengaturan Auth yang diubah.

Artefak lokal: `dist-harness/qa/hosted-anon-smoke.json` (git-ignored). Ini bukti hosted untuk penolakan anonim/token/CORS dan konektivitas publik saja; RLS antarpengguna, consent/budget/ledger, PDF, restore hosted dan provider live tetap memerlukan acceptance terpisah. AI tetap nonaktif; tidak ada provider operation, signup, migrasi atau perubahan data yang diminta pada pemeriksaan ini.

### Perbaikan guard rubrik/prompt dan audit dev berisi data — 9 Oktober 2026

Regresi tambahan menemukan `app.versioned_content_guard()` membaca `NEW.content` saat dipakai oleh tabel rubrik, yang tidak mempunyai kolom tersebut. Perubahan bobot dapat gagal dengan SQLSTATE `42703`; trigger prompt juga berisiko membaca `NEW.content_json`. Migrasi tambahan `20261009000010_versioned_content_guard.sql` memisahkan cabang berdasarkan tabel sebelum membaca field. Isi, versi dan hash snapshot tetap tidak dapat diubah; binding trigger dan ACL dipertahankan. Sembilan migrasi historis tidak diedit, data/bobot pengguna tidak direset atau di-reseed.

Audit baru `scripts/hosted-audit.mjs` menerima database dev berisi akun/proyek nyata. Semua query audit berjalan dalam transaksi **repeatable-read/read-only**, lalu rollback. Audit membandingkan hash SQL migrasi, tabel/RLS, grant kolom, policy, source/ACL/search-path fungsi, trigger, bucket PDF privat, rubrik/prompt asli, Google-only membership dan AI tetap OFF. Output hanya agregat dan status; tidak berisi email, ID pengguna/proyek, teks naskah atau secret.

Workflow manual existing mempunyai job D terpisah yang checkout SHA dispatch persis. Default D hanya audit read-only; opsi `apply_rubric_guard_repair` menjalankan audit kondisi awal lalu runner existing dengan `--only=20261009000010`, tanpa `--seed`, dan audit ulang. Mode persona C tetap tidak boleh dijalankan pada dev sekarang. Audit native tetap bukan bukti login Google mahasiswa, cross-user UI/PDF, restore hosted atau provider live.

Build produksi, Edge TypeScript, workspace 27/27, restore 22/22 dan AI mock 14/14 lulus sesudah perubahan ini. Tes `yarn test:hosted:audit` **11/11 lulus**, termasuk owner authenticated menyimpan bobot dan mahasiswa tidak dapat mengubahnya, transaksi read-only, penolakan drift migrasi/RLS/policy/ACL service-only, bucket publik/AI aktif, bobot pengguna tanpa reseed, dan immutable snapshot. AI tetap nonaktif.

[Run 37867323836](https://github.com/indrawaspada/bimbing-TA/actions/runs/37867323836), SHA `a2a106c836707db41e74ad483969e37c10639aa1`, **SUCCESS**. Audit awal sembilan migrasi lulus, hanya migrasi 0010 diterapkan **07:57:54 WIB**, lalu audit read-only akhir lulus **07:58:02 WIB** (00:58:02 UTC), 9 Oktober 2026. Sepuluh hash SQL migrasi cocok; **28 tabel RLS, 56 fungsi, 62 policy, 47 trigger**, private PDF bucket, 92 aturan/rubrik dan prompt asli cocok dengan sumber. Config membership Google-only. Model aktif, anggaran AI aktif, run dan reservation masing-masing **0**.

Agregat sebelum/sesudah sama: **1 Auth user, 1 owner aktif, 0 mahasiswa aktif, 1 proyek, 2 undangan, 0 versi dan 0 PDF Storage**. Tidak ada test persona, perubahan Auth/provider, reset, reseed, atau penghapusan data. Ini juga mengonfirmasi login mahasiswa dan alur PDF belum mempunyai data acceptance nyata. Secret DB tetap di Actions, service key tidak dipakai atau diambil ke workspace. Cloudflare untuk SHA yang sama **SUCCESS**, selesai **07:57:42 WIB**; preview tetap https://codex-checkpoint-d.bimbing-ta.pages.dev/.

Run awal [37867092448](https://github.com/indrawaspada/bimbing-TA/actions/runs/37867092448) berhenti sebelum migrasi karena parser `pg` mengembalikan `name[]` roles sebagai string, sementara PGlite mengembalikan array. Query katalog diperbaiki menggunakan `roles::text[]`; perbandingan aturan akses tetap ketat, bukan dilewati. Run sukses di atas membuktikan policy/function/trigger hosted cocok, termasuk guard 0010 sesudah repair.

### Lanjutan native SQL restore rollback — 9 Oktober 2026

Runner terpisah `scripts/hosted-restore-rehearsal.mjs` disiapkan untuk ZIP sintetis manual pada dev berisi owner/proyek nyata. CLI wajib menerima ref dev exact dan `--use-existing-owner`; identitas owner tunggal yang aktif dan terverifikasi Google dipakai sebagai pemetaan eksplisit. Owner/akun/proyek lama tidak diubah. Mahasiswa sintetis, undangan, proyek restore, versi/PDF metadata, revisi/proof, komentar, pertemuan, sumber, milestone dan keterlacakan hanya dibuat dalam transaksi, tanpa Auth/Storage API.

Setiap kasus berakhir **ROLLBACK**, bukan commit. Jumlah serta SHA-256 isi seluruh 28 tabel public dan `auth.users`, `storage.objects`, `storage.buckets` dibandingkan sebelum/sesudah, dihitung di SQL tanpa mengirim baris asli ke workspace/log. Role authenticated owner/student diuji dengan `SET LOCAL ROLE` dan simulated JWT claims untuk memeriksa akses proyek hasil restore, isolasi proyek lama, catatan privat dan Storage RLS. Ini bukan token Supabase atau login Google.

Kasus native yang disiapkan: dua versi berurutan dan gap v1/v4, masing-masing dua PDF sebagai byte sintetis dan relasi lengkap. Hash file/snapshot, pemetaan proof/balasan/locator dan penghapusan penanda sequence tetap diverifikasi; definisi guard, RLS, policy dan ACL tidak diubah. Budget/model/provider AI tidak disentuh. Audit dev read-only dijalankan sebelum/sesudah. Mode workflow `run_restore_sql_rehearsal=true` default **false**; memakai hanya DB Secret setelah build/tes, di branch D.

Regresi lokal restore **28/28 lulus**: 22 kasus offline terdahulu serta enam kasus tambahan untuk target nonempty, data awal identik, RLS, kegagalan di tengah transaksi, mapping owner tidak valid, gap dan penolakan flag apply. Audit/guard lokal **11/11 lulus**. B02 restore file melalui layanan Supabase, Google mahasiswa, ledger concurrency dan provider live masih tertunda. CLI offline tetap tidak menerima mode hosted/apply.

[Run 37875028465](https://github.com/indrawaspada/bimbing-TA/actions/runs/37875028465), SHA `170b984b2b4a034773452f555dfe942ee11c7fe7`, **SUCCESS**, selesai **9 Oktober 2026 09:33:47 WIB** (02:33:47 UTC). Frozen install, build/frontend TypeScript, Edge TypeScript, 11 tes audit, enam tes rollback lokal, audit native dev dan **2/2 kasus restore SQL hosted lulus**. Pada tiap kasus: 2 versi, 1 revisi/proof, 2 komentar/balasan, 1 pertemuan, 1 sumber, 1 milestone, 1 keterlacakan dan 2 file sebagai byte sintetis. Gap v1/v4 mempertahankan sequence serta membersihkan dua penanda sementara. Role SQL dan Storage RLS lulus; semua transaksi rollback dan **31 tabel awal terverifikasi identik**, tanpa menampilkan hash/isi/identitas asli.

Report: `mode=hosted_native_sql_rollback`, `synthetic_fixture=true`, `rollback_verified=true`, `original_data_unchanged=true`, `sql_role_access_checked=true`, `api_auth_tested=false`, `api_storage_tested=false`, `provider_called=false`, `ai_enabled=false`. Audit sebelum/sesudah cocok dengan sumber sepuluh migrasi dan AI OFF. Tidak ada migrasi/reseed/commit data pengguna, Auth/Storage API, Google login, provider call atau persistent restore. Cloudflare SHA yang sama **SUCCESS**, selesai **09:32:56 WIB**; preview tetap Cloudflare Pages, main tetap checkpoint C.

### Konkurensi ledger PostgreSQL native terpisah — 9 Oktober 2026

`yarn test:ledger:native` disiapkan untuk PostgreSQL **17.11** disposable di localhost runner CI, memakai shim dan seluruh migrasi sumber tanpa mengubah SQL fungsi. Harness menolak URI hosted, database selain `bimbingta_ledger_test`, database nonempty atau engine bukan PostgreSQL 17 sebelum inisialisasi. Tidak membaca admin/provider config, tidak memakai kredensial Supabase, tidak menjalankan HTTP atau provider. Model/budget AI sintetis hanya aktif pada database test terpisah; AI Supabase dev tetap OFF.

Sembilan kasus native memeriksa dua koneksi/backend PID berbeda: idempotency sama, cap biaya bulanan lintas proyek, cap jumlah panggilan, satu run aktif per proyek, rollback klaim pertama, cache, penolakan redirect idempotency, budget disabled dan ACL RPC service-only. Tujuh skenario overlap wajib membuktikan waiter diblokir backend pertama melalui `pg_blocking_pids`; tidak mengandalkan sleep/perintah berurutan sebagai bukti konkurensi. Klaim yang mendapat dispatch tidak memanggil provider. Database/container dibuang oleh runner setelah job.

Workflow existing menambah job `isolated_native_ledger` dengan opsi `run_native_ledger_tests=true` default false. Job memakai PostgreSQL service terpisah dan **tanpa repository Secrets**; job audit dev tetap terpisah dan read-only. Dua pengaman target lulus lokal; Docker engine lokal tidak tersedia. Pengujian ini bukan Supabase gateway/Edge/provider live atau login Google; acceptance hosted/live tetap terpisah.

[Run 37877916874](https://github.com/indrawaspada/bimbing-TA/actions/runs/37877916874), SHA `f4023bde4a4137be9520f2c970a7beff6349a3c2`, **SUCCESS**, 9 Oktober 2026. **11/11 tes lulus** pada **10:09:30 WIB** (03:09:30 UTC): sembilan kasus database dan dua pengaman. Engine `17.11 (Debian 17.11-1.pgdg12+2)` menerapkan sepuluh migrasi sumber; **7/7 skenario overlap membuktikan lock wait** dengan backend PID berbeda. Cache berantai kembali ke hasil asal yang selesai, konten sama, tanpa dispatch/reservasi baru. Summary: `supabase_tested=false`, `provider_called=false`, `synthetic_database=true`, `supabase_ai_changed=false`. Container dibuang setelah tes.

Job dev pada run yang sama lulus frozen install, build/Edge TypeScript, 11 audit lokal, enam rollback lokal dan audit hosted read-only, selesai **10:09:28 WIB**. AI asli tetap OFF; tidak ada migrasi/reseed/perubahan data dev. Cloudflare source yang sama **SUCCESS**, **10:10:48 WIB**. Browser tetap tidak terhubung sehingga Google mahasiswa, PDF hosted dan restore layanan file tetap belum diuji dalam sesi ini.

Run pertama `37877453121` dan kedua `37877697969` lulus 10/11; kegagalan ada pada assertion fixture cache, bukan fungsi ledger. Tes awal terlalu mengharuskan direct cached_from ke root; tes kedua membandingkan payload dengan objek run sebelum selesai. Tes kini menelusuri provenance ke root selesai, membandingkan payload selesai dan biaya baru nol, tanpa perubahan fungsi/migrasi atau melewati assertion inti. Run sukses di atas merupakan bukti final; run gagal tidak dihitung lulus.

## Referensi kontrak (dibuka 8 Oktober 2026)

### Layanan file pada dev nonempty — persiapan 9 Oktober 2026

Runner terpisah `scripts/hosted-file-rehearsal.mjs` disiapkan untuk **Auth/PostgREST/Storage nyata** pada dev berisi owner, tanpa menjalankan suite empty-DEV lama. Ref dev dan `--use-existing-owner` wajib exact. Tiga akun `bt-file-…@example.test` dibuat admin dengan email terkonfirmasi, tanpa signup, undangan Auth/email, password reset atau Google impersonation; password/JWT hanya di memori. Dua membership mahasiswa adalah enrollment SQL fixture eksplisit, bukan hasil Google claim. Owner lama hanya dipakai sebagai mapping restore; tidak ada token/login owner yang dibuat/diambil. Policy aplikasi tetap Google-only; Email Auth harus sudah aktif di dev atau runner menolak tanpa mengubah settings.

Dua proyek baru bertanda run unik disiapkan. ZIP sintetis manual dipetakan ke proyek mahasiswa A, dengan versi/file, halaman/rentang, revisi/proof, komentar/balasan, pertemuan, sumber, milestone dan keterlacakan. Transfer dua file dan URL bertanda tangan memakai publishable key + JWT mahasiswa yang diterbitkan Supabase, bukan service key. Mahasiswa B, outsider email yang diundang namun tidak dienroll, dan anon menguji penolakan scope, promote role, owner fields, private notes, page/finding/file/signed URL. Edge `action=status` mahasiswa diuji tanpa aksi provider. Ini tidak membuktikan Google OAuth atau ekstraksi browser.

Mode ini melakukan **commit fixture sementara** agar layanan Auth/Storage/REST dapat membacanya, lalu cleanup wajib. Jurnal recovery disiapkan sebelum mutasi, berisi marker run, ID dua proyek baru, tiga email sintetis exact, hash ZIP/source dan jumlah/hash isi 31 tabel awal; tidak berisi password, token, signed URL, owner email/ID, teks asli atau secret. Artifact recovery exact diupload sebelum akun/proyek/file dibuat; kegagalan upload artifact menghentikan langkah mutasi. Tidak boleh membatalkan paksa di tengah mode ini. Recovery hanya menghapus objek/proyek ber-marker run dan Auth user ber-email+metadata marker exact; original owner/proyek dilindungi. Storage dibersihkan sebelum metadata proyek dihapus agar retry tetap mempunyai registry. Admin API/DB hanya setup dan cleanup; tidak dipakai untuk asserted access.

Saat persiapan: **9/9 tes lokal file QA dan 28/28 restore lulus**, PostgreSQL WASM/RLS nyata dengan transport Auth/Storage tiruan, bukan bukti API hosted. Case normal, failure saat transfer, cleanup Storage gagal/retry/idempotent, journal palsu menunjuk original project/user, perubahan ZIP, redirect signed URL, mapping student/project, CLI tanpa arbitrary ZIP/apply tercakup. Workflow D menambah `run_file_service_rehearsal` default false dan recovery always-run. AI/model/budget/migrasi/Google-only settings tidak disentuh; hasil hosted akan dicatat setelah eksekusi.

- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/your-data
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/thinking
- https://supabase.com/docs/guides/functions/auth
