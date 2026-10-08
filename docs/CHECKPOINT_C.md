# Checkpoint C — BimbingTA Copilot

Implementasi dilanjutkan dari kode A/B; tidak memakai kredit Emergent. Tahap D (AI) sudah ditambahkan pada branch checkpoint-d; lihat CHECKPOINT_D.md untuk status validasi/aktivasi hosted.

## Fitur

- **Naskah:** PDF privat per versi; SHA-256 file, teks halaman, dan snapshot ekstraksi. Pratinjau serta ekstraksi memakai worker PDF.js di browser; worker, font, CMap, dan WASM disajikan dari aplikasi sendiri. Tidak ada OCR eksternal.
- **Konfirmasi:** rentang Bab I–V diisi manual dengan indeks halaman PDF asli. Label tercetak disimpan terpisah. Teks scan/ekstraksi kosong dapat ditempel per halaman; visual tetap `Not assessed`. Setelah konfirmasi, file, halaman, dan rentang terkunci. Koreksi melalui versi baru.
- **Unggahan:** batas 25 MB/file, saran <5 MB, kuota default 35 MB/proyek, dan penjaga global. Reservasi tidak hilang karena umur unggahan. Server memeriksa path serta ukuran Storage, termasuk finalisasi backend yang memakai peran istimewa. Kegagalan upload dipisahkan dari kegagalan ekstraksi. Unggahan ambigu bisa dilanjutkan dengan file asli.
- **Komentar:** halaman/bab, balasan dalam lingkup yang sama, komentar revisi, dan diskusi proyek. Pembaruan tiap 15 detik hanya untuk thread yang sedang tampil; berhenti ketika halaman tersembunyi atau thread ditutup. Teks dirender sebagai teks React.
- **Revisi:** instruksi dosen, keparahan, bab/halaman sumber, tenggat dan kriteria penerimaan. `Open → In progress → Submitted → Verified closed → Reopened`. Pengajuan wajib memakai versi baru yang sudah terkunci, halaman valid dan uraian perbaikan. Hanya dosen dapat memverifikasi atau membuka kembali; alasan pembukaan kembali dan transisi disimpan dalam audit.
- **Pertemuan:** jadwal WIB, durasi, agenda, keputusan dosen, target berikutnya, tenggat, tautan HTTPS dan kalender ICS. Mahasiswa membaca keputusan; tidak dapat mengubahnya.
- **Sumber:** tautan referensi, repo, demo dan video HTTPS. Lampiran sumber PDF belum menjadi fitur C; jalur upload lampiran lama yang belum terpakai dinonaktifkan agar tidak melewati kuota. Video disimpan sebagai tautan.
- **Kenyamanan:** draf form tersimpan privat di database, autosave berseri, indikator gagal, retry, dan konflik sesi. Perubahan teks/rentang draf harus diterapkan sebelum mengunci naskah. Notifikasi komentar/revisi/pertemuan dan indikator tenggat tersedia di aplikasi. Catatan privat dosen tetap terpisah.
- **Ekspor:** CSV revisi, metadata JSON, laporan HTML untuk Cetak/Simpan PDF, dan ZIP berisi metadata, laporan, CSV, PDF asli serta manifest SHA-256. Tidak memuat catatan privat, draf, sesi login, atau kredensial. Kegagalan satu file membatalkan backup. Ekspor tidak membuktikan bahwa sistem operasi menyimpan file: pengguna tetap memeriksa ZIP di laptop.
- **Penghapusan:** hanya dosen, setelah backup diperiksa dan dikonfirmasi. Versi terbaru, sumber revisi/bukti dan versi yang memiliki komentar tidak bisa dihapus. Permintaan penghapusan mengunci penambahan referensi baru dan dapat dilanjutkan dari tab Ekspor jika proses terputus. Tidak ada penghapusan otomatis.

## Menjalankan dari laptop atau Codex

Gunakan Node 22 terbaru atau Node 24 dan Yarn Classic 1.22.22. `yarn.lock` adalah lockfile proyek.

```bash
npm install -g yarn@1.22.22
yarn install --frozen-lockfile
```

Buat `.env.local` dari `.env.example`, lalu isi **hanya** URL Supabase dan publishable key. Jangan menaruh password database atau kunci service role dalam `VITE_*`.

```bash
yarn dev
# Buka alamat localhost yang ditampilkan Vite.
yarn build
# Hasil: dist/; dapat dihosting di Cloudflare Pages.
```

Menjalankan pengembangan ini tidak memakai kredit Emergent. Tahap C berjalan tanpa API AI. Ketersediaan paket hosting/database gratis tetap mengikuti batas layanan penyedia.

## Migrasi hosted

Migrasi baru: `supabase/migrations/20261006000007_workspace.sql`. Keenam migrasi sebelumnya tidak diubah. Runner otomatis mengambil file tertunda; jangan menjalankan reset atau mengulang migrasi yang sudah tercatat.

Ikuti `docs/HOSTED_SETUP.md` untuk setup baru. Kredensial admin hanya di environment server atau `.secrets/admin.env`, diabaikan Git. Migrasi C sudah diterapkan dan diuji hosted; lihat hasil historis di `docs/HOSTED_STATUS.md`. Proyek dev kini memiliki sembilan migrasi dan owner nyata; status terbaru ada di `docs/CHECKPOINT_D.md`. Jangan menerapkan ulang atau mereset proyek tersebut.

```bash
node scripts/hosted-migrate.mjs
# Periksa target dan daftar migrasi terlebih dahulu.
node scripts/hosted-migrate.mjs --apply --confirm-ref=<project-ref> --seed
```

Runner melakukan transaksi per migrasi dan berhenti jika ada kegagalan. Setelah apply, jalankan suite hosted dan checklist Google OAuth. Bootstrap owner hanya sekali melalui SQL Editor; jangan membuat owner kedua.

## Validasi dan batasnya

Lingkungan pengembangan C: Node **24.19.0**. Build TypeScript/Vite lolos; instalasi Yarn Classic dengan frozen lockfile juga lolos tanpa mengabaikan engine. Build hosted CI kemudian lolos pada Node **22.23.3**; lihat `docs/HOSTED_STATUS.md`.

| Pemeriksaan | Hasil | Yang benar-benar diuji |
| --- | --- | --- |
| `yarn test:workspace` | **27/27 lolos** | PostgreSQL WASM (PGlite 0.5.8 / PostgreSQL 18.3), seluruh 7 migrasi dan seed. RLS, grants, trigger, RPC, isolasi A/B, workflow, konflik, kuota, snapshot, draft, ekspor/penghapusan; serializer CSV/HTML/ICS/HTTPS. |
| `yarn test:score` | **4/4 lolos** | Kernel skor, 92 aturan toolkit dan bobot tidak berubah. |
| `yarn test:ui:local` | **Lolos** | Chromium 153: PDF upload/worker/rentang/konfirmasi/reload di lebar 390 px, autosave/retry/diskusi, keputusan dosen, lifecycle revisi dengan versi baru, sumber HTTPS, CSV dan ZIP asli, polling berhenti saat thread ditutup. |
| Supabase hosted | **40/40 SQL dan 22/22 HTTP persona C lolos** | Hasil historis di `docs/HOSTED_STATUS.md`; persona sintetis bukan bukti Google OAuth atau ekstraksi browser. Login Google owner kemudian lolos pada preview D; alur mahasiswa nyata dan PDF hosted masih tertunda (`docs/CHECKPOINT_D.md`). |

Harness portabel menjalankan SQL PostgreSQL asli tetapi **memetakan REST dan status HTTP secara sintetis**. Judul tes regresi B masih menyebut REST; pada `test:workspace` itu bukan permintaan ke PostgREST sungguhan. Auth dan Storage di tes browser juga sintetis. Tes ini membuktikan kode/SQL lokal, bukan integrasi hosted. Percobaan PostgREST melalui socket PGlite tidak dijadikan bukti karena penanganan error wire protocol tidak sesuai layanan sebenarnya.

Untuk regresi REST pada PostgreSQL native yang mendukung harness lama:

```bash
yarn test:workspace:rest
```

Perintah tersebut membuat ulang **database uji lokal**; jangan arahkan ke database hosted atau data nyata. Ia memerlukan PostgreSQL 15 dan PostgREST seperti harness B. Belum dijalankan sampai tuntas untuk C dalam lingkungan Codex ini.

Hash SHA-256 file dihitung browser lalu diperiksa kembali saat ekspor; server memvalidasi ukuran/path dan menghitung hash teks/snapshot SQL. Hash file bukan pemindaian malware atau pemeriksaan isi PDF oleh server. ZIP adalah backup proyek manual; restore terotomatisasi termasuk tahap E.

Tidak ada DOCX parser, hosting video, email, live chat, atau grup dalam tahap C.

## Dokumentasi teknis rujukan

- PDF.js: https://mozilla.github.io/pdf.js/examples/ dan https://mozilla.github.io/pdf.js/api/draft/api.js.html
- Storage RLS: https://supabase.com/docs/guides/storage/security/access-control
- Storage upload/preflight: https://github.com/supabase/storage/blob/master/src/storage/uploader.ts
- PostgREST response: https://postgrest.org/en/v12/references/api/functions.html
- PGlite: https://pglite.dev/docs/about
