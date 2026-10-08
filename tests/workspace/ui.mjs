// Browser acceptance against the SQL adapter: synthetic Auth and in-memory Storage,
// actual app build and PDF.js worker, actual SQL migrations/RLS. Never Google OAuth.
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import http from "node:http";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { chromium } from "playwright-core";
import binary from "@sparticuz/chromium";
import { db, rest } from "./sql-adapter.mjs";
const exec = async (q, p) => db.query(q, p);
const secret = "local-test-secret-not-for-production-000000";
function token(id, email) {
  const head = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" }),
    ).toString("base64url"),
    body = Buffer.from(
      JSON.stringify({
        sub: id,
        email,
        role: "authenticated",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
const owner = { id: randomUUID(), email: "owner.ui@example.test" },
  student = { id: randomUUID(), email: "student.ui@example.test" };
for (const p of [owner, student]) {
  p.token = token(p.id, p.email);
  await exec(
    "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,now(),$3,$4)",
    [
      p.id,
      p.email,
      { provider: "google", providers: ["google"] },
      { full_name: p === owner ? "Dosen sintetis" : "Mahasiswa sintetis" },
    ],
  );
}
await exec("select bootstrap_owner($1)", [owner.email]);
await rest(owner.token, "POST", "/rpc/claim_membership", {});
const inv = (
  await rest(owner.token, "POST", "/invitations", {
    normalized_email: student.email,
  })
).json[0];
const project = (
  await rest(owner.token, "POST", "/projects", {
    title: "Proyek UI Checkpoint C",
    invitation_id: inv.id,
  })
).json[0];
await rest(student.token, "POST", "/rpc/claim_membership", {});
const blobs = new Map();
let queue = Promise.resolve();
let polls = 0;
let failDraft = 0;
const requests = [];
async function as(who, fn) {
  await db.exec("begin");
  try {
    const claims = JSON.parse(
      Buffer.from(who.split(".")[1], "base64url").toString(),
    );
    await db.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify(claims),
    ]);
    await db.exec("set local role authenticated");
    const result = await fn();
    await db.exec("commit");
    return result;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const root = new URL("../../dist-harness/", import.meta.url).pathname;
const server = http.createServer(async (req, res) => {
  const body = await new Promise((resolve) => {
    const parts = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => resolve(Buffer.concat(parts)));
  });
  const handler = async () => {
    try {
      const auth = req.headers.authorization?.replace(/^Bearer /, "");
      if (req.url.startsWith("/rest/v1/")) {
        requests.push(req.url);
        if (req.url.startsWith("/rest/v1/comments")) polls++;
        if (
          req.method === "PATCH" &&
          req.url.startsWith("/rest/v1/workspace_drafts") &&
          failDraft-- > 0
        ) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "Simulasi koneksi gagal" }));
          return;
        }
        const result = await rest(
          auth,
          req.method === "HEAD" ? "GET" : req.method,
          req.url.slice(8),
          body.length ? JSON.parse(body) : undefined,
        );
        let json = result.json;
        const headers = {
          "content-type": "application/json",
          "content-range": `0-${Math.max(0, (json?.length || 1) - 1)}/${json?.length || 0}`,
        };
        if (
          result.status < 400 &&
          req.headers.accept?.includes("vnd.pgrst.object")
        ) {
          if (!Array.isArray(json) || json.length !== 1) {
            res.writeHead(406, headers);
            res.end(
              JSON.stringify({ code: "PGRST116", message: "Expected one row" }),
            );
            return;
          }
          json = json[0];
        }
        res.writeHead(result.status, headers);
        res.end(req.method === "HEAD" ? "" : JSON.stringify(json));
        return;
      }
      if (req.url.startsWith("/storage/v1/object/")) {
        const path = decodeURIComponent(
          req.url
            .split("?")[0]
            .replace(
              /^\/storage\/v1\/object\/(authenticated\/)?thesis-files\//,
              "",
            ),
        );
        if (req.method === "POST") {
          await as(auth, () =>
            exec(
              "insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)",
              [path, { size: body.length, mimetype: "application/pdf" }],
            ),
          );
          blobs.set(path, body);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ Key: "thesis-files/" + path }));
          return;
        }
        if (req.method === "GET") {
          const r = await as(auth, () =>
            exec(
              "select * from storage.objects where bucket_id='thesis-files' and name=$1",
              [path],
            ),
          );
          if (!r.rows.length || !blobs.has(path))
            throw new Error("File not accessible");
          res.writeHead(200, { "content-type": "application/pdf" });
          res.end(blobs.get(path));
          return;
        }
      }
      const path = req.url.split("?")[0];
      const file = extname(path) ? path : "index.html";
      const content = await readFile(join(root, file));
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".wasm": "application/wasm",
      };
      res.writeHead(200, {
        "content-type": types[extname(file)] || "application/octet-stream",
      });
      res.end(content);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: e.message }));
    }
  };
  queue = queue.then(handler, handler);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
// Vite compile uses this synthetic URL, never a real Supabase URL/key.
const build = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--outDir", "dist-harness"],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_ANON_KEY: "test-only",
    },
    encoding: "utf8",
  },
);
if (build.status) throw new Error(build.stderr);
const binBase = "node_modules/@sparticuz/chromium/bin/";
if (
  !existsSync("/tmp/chromium") ||
  (await readFile("/tmp/chromium")).length < 1000
) {
  await writeFile(
    "/tmp/chromium",
    brotliDecompressSync(await readFile(binBase + "chromium.br")),
  );
  await chmod("/tmp/chromium", 0o700);
}
for (const name of ["fonts", "swiftshader"]) {
  await writeFile(
    `/tmp/${name}.tar`,
    brotliDecompressSync(await readFile(binBase + name + ".tar.br")),
  );
  await mkdir(name === "fonts" ? "/tmp/fonts" : "/tmp", { recursive: true });
  const r = spawnSync("tar", [
    "--no-same-owner",
    "-xf",
    `/tmp/${name}.tar`,
    "-C",
    name === "fonts" ? "/tmp/fonts" : "/tmp",
  ]);
  if (r.status) throw new Error(r.stderr.toString());
}
const browser = await chromium.launch({
  executablePath: "/tmp/chromium",
  // Single-process Chromium shares session state across test contexts; use
  // separate renderer processes so owner and student remain distinct actors.
  args: binary.args.filter((a) => !a.includes("disable-web-security") && a !== "--single-process"),
  headless: true,
});
const errors = [];
let page;
async function login(person, width = 1280) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    acceptDownloads: true,
  });
  await context.addInitScript(
    (p) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: p.token,
          refresh_token: "synthetic",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: p.id,
            email: p.email,
            aud: "authenticated",
            role: "authenticated",
            app_metadata: { provider: "google" },
            user_metadata: {},
          },
        }),
      ),
    person,
  );
  const p = await context.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) =>
    d.accept(
      d.type() === "prompt" ? "Validasi masih perlu diperbaiki" : undefined,
    ),
  );
  return p;
}
function pdfFixture() {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    null,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [i, text] of [
    [3, "Bab I Pendahuluan"],
    [5, "Bab III Metode validasi"],
  ]) {
    const stream = `BT /F1 14 Tf 50 780 Td (${text}) Tj ET`;
    objs[i] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let out = "%PDF-1.4\n",
    offset = [0];
  for (let i = 0; i < objs.length; i++) {
    offset.push(out.length);
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offset
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}
try {
  const traceOwner = await login(owner);
  // Saving an existing record must retain the new values in its persisted
  // editor draft, including after reload and a subsequent edit of another field.
  await traceOwner.goto(`${url}/proyek/${project.id}/keterlacakan`);
  await traceOwner.getByRole("button", { name: "Tambah keterlacakan", exact: true }).click();
  await traceOwner.getByLabel("Tujuan", { exact: true }).fill("Tujuan awal");
  await traceOwner.getByRole("button", { name: "Simpan keterlacakan", exact: true }).click();
  await traceOwner.getByRole("cell", { name: "T1 Tujuan awal", exact: true }).waitFor();
  await traceOwner.waitForFunction(() => document.querySelector('input[maxlength="20"]')?.value === "T1" && [...document.querySelectorAll("textarea")].some(t => t.value === ""));
  assert.equal(await traceOwner.getByLabel("Tujuan", { exact: true }).first().inputValue(), "");
  await traceOwner.getByRole("button", { name: "Tambah keterlacakan", exact: true }).click();
  await traceOwner.getByText("Ubah / verifikasi", { exact: true }).click();
  const traceNote = "Periksa lingkup dan evaluasi pada bimbingan pertama";
  await traceOwner.getByLabel(/^Catatan pembimbing/).fill(traceNote);
  await traceOwner.getByRole("button", { name: "Simpan keterlacakan", exact: true }).click();
  await traceOwner.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Simpan keterlacakan" && !b.disabled));
  assert.equal(await traceOwner.getByLabel(/^Catatan pembimbing/).inputValue(), traceNote);
  await traceOwner.reload();
  await traceOwner.getByText("Ubah / verifikasi", { exact: true }).click();
  await traceOwner.getByLabel(/^Catatan pembimbing/).waitFor();
  assert.equal(await traceOwner.getByLabel(/^Catatan pembimbing/).inputValue(), traceNote);
  await traceOwner.getByLabel("Masalah", { exact: true }).fill("Masalah diperbarui");
  await traceOwner.getByRole("button", { name: "Simpan keterlacakan", exact: true }).click();
  await traceOwner.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Simpan keterlacakan" && !b.disabled));
  const traceSaved = (await exec("select * from traceability_rows where project_id=$1", [project.id])).rows;
  assert.equal(traceSaved.length, 1);
  assert.equal(traceSaved[0].owner_note, traceNote);
  assert.equal(traceSaved[0].problem, "Masalah diperbarui");
  assert.equal(traceSaved[0].status, "draft");
  console.log("UI: traceability creation clears the new form; edits survive save, reload and a second-field edit");

  await traceOwner.close();
  page = await login(student, 390);
  await page.goto(`${url}/proyek/${project.id}/naskah`);
  await page
    .getByLabel("Unggah naskah", { exact: true })
    .setInputFiles({
      name: "thesis.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture(),
    });
  await page
    .getByRole("button", { name: "Ekstrak teks PDF", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Ekstrak teks PDF", exact: true })
    .click();
  await page.getByLabel("Teks hasil ekstraksi / tempel teks").waitFor();
  await page.waitForFunction(() =>
    document.querySelector('textarea[rows="8"]')?.value.includes("Pendahuluan"),
  );
  await page.getByLabel("B1 awal", { exact: true }).fill("1");
  await page.getByLabel("B1 akhir", { exact: true }).fill("1");
  await page.getByLabel("B3 awal", { exact: true }).fill("2");
  await page.getByLabel("B3 akhir", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Terapkan rentang bab", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector("button") &&
      [...document.querySelectorAll('[role="alert"]')].length === 0,
  );
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Konfirmasi dan kunci versi", exact: true })
    .click();
  await page.getByText("Versi telah dikonfirmasi.", { exact: false }).waitFor();
  await page.reload();
  await page.getByText("Versi telah dikonfirmasi.", { exact: false }).waitFor();
  assert.equal(
    await page
      .getByLabel("Teks hasil ekstraksi / tempel teks")
      .getAttribute("readonly"),
    "",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  console.log(
    "UI: mobile PDF upload, bundled worker extraction, ranges, sealing and reload passed",
  );
  await page.goto(`${url}/proyek/${project.id}/diskusi`);
  failDraft = 1;
  await page.getByLabel("Isi komentar").fill("Draf diskusi persist");
  await page.getByText(/Gagal menyimpan:/).waitFor();
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await page.getByText(/^Tersimpan /).waitFor();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("textarea")?.value === "Draf diskusi persist",
  );
  await page.getByRole("button", { name: "Kirim komentar" }).click();
  await page.getByText("Draf diskusi persist", { exact: true }).waitFor();
  const before = await exec(
    "select count(*)::int n from comments where project_id=$1",
    [project.id],
  );
  assert.equal(before.rows[0].n, 1);
  console.log(
    "UI: private draft autosave, reload and persisted comment passed",
  );
  await page.goto(`${url}/proyek/${project.id}/pertemuan`);
  await page.getByText("Belum ada pertemuan").waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Jadwalkan pertemuan" }).count(),
    0,
  );
  const p = await login(owner);
  await p.goto(`${url}/proyek/${project.id}/pertemuan`);
  await p.getByRole("button", { name: "Jadwalkan pertemuan" }).click();
  await p.getByLabel("Waktu pertemuan (WIB)").fill("2026-10-20T10:00");
  await p.getByLabel("Keputusan dosen").fill("Gunakan validasi 5-fold");
  await p.getByRole("button", { name: "Simpan pertemuan" }).click();
  await p.getByText("Gunakan validasi 5-fold", { exact: false }).waitFor();
  await page.reload();
  await page.getByText("Gunakan validasi 5-fold", { exact: false }).waitFor();
  console.log(
    "UI: owner meeting decision persists and student has read-only access",
  );
  await p.goto(`${url}/proyek/${project.id}/revisi`);
  await p.getByRole("button", { name: "Tambah revisi" }).click();
  await p.getByLabel("Judul revisi").fill("Validasi metode");
  const source = (
    await exec("select * from versions where project_id=$1 order by sequence", [
      project.id,
    ])
  ).rows[0];
  await p.getByLabel("Versi sumber").selectOption(source.id);
  await p
    .getByLabel("Kriteria penerimaan (wajib)")
    .fill("Laporkan hasil 5-fold");
  await p.getByRole("button", { name: "Buat revisi", exact: true }).click();
  await p.getByRole("heading", { name: "Validasi metode" }).waitFor();
  await page.goto(`${url}/proyek/${project.id}/naskah`);
  await page
    .getByLabel("Unggah naskah", { exact: true })
    .setInputFiles({
      name: "thesis-v2.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture(),
    });
  await page
    .getByRole("button", { name: "Ekstrak teks PDF", exact: true })
    .click();
  await page.getByLabel("Teks hasil ekstraksi / tempel teks").waitFor();
  await page.getByLabel("B1 awal", { exact: true }).fill("1");
  await page.getByLabel("B1 akhir", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Terapkan rentang bab", exact: true })
    .click();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Konfirmasi dan kunci versi", exact: true })
    .click();
  await page.getByText("Versi telah dikonfirmasi.", { exact: false }).waitFor();
  await page.goto(`${url}/proyek/${project.id}/revisi`);
  await page
    .getByRole("button", { name: "Mulai kerjakan", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Ajukan bukti perbaikan", exact: true })
    .click();
  const newer = (
    await exec(
      "select * from versions where project_id=$1 order by sequence desc",
      [project.id],
    )
  ).rows[0];
  await page.getByLabel("Versi bukti").selectOption(newer.id);
  await page
    .getByLabel("Perbaikan yang memenuhi kriteria")
    .fill("Hasil validasi 5-fold ditambahkan");
  await page
    .getByRole("button", { name: "Ajukan kepada dosen", exact: true })
    .click();
  await page
    .locator("span")
    .filter({ hasText: /^Diajukan$/ })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Verifikasi selesai" }).count(),
    0,
  );
  await p.reload();
  await p.getByLabel("Filter revisi").selectOption("all");
  await p
    .getByRole("button", { name: "Verifikasi selesai", exact: true })
    .click();
  await p
    .locator("span")
    .filter({ hasText: /^Terverifikasi selesai$/ })
    .waitFor();
  await p.getByRole("button", { name: "Buka kembali", exact: true }).click();
  await p
    .locator("span")
    .filter({ hasText: /^Dibuka kembali$/ })
    .waitFor();
  console.log(
    "UI: revision creation, new-version proof, owner verification and reopen passed",
  );
  await page.goto(`${url}/proyek/${project.id}/sumber`);
  await page
    .getByRole("button", { name: "Tambah tautan", exact: true })
    .click();
  await page.getByLabel("Judul sumber").fill("Demo aplikasi");
  await page.getByLabel("Tautan HTTPS").fill("https://example.test/demo");
  await page
    .getByRole("button", { name: "Simpan tautan", exact: true })
    .click();
  await page.getByRole("heading", { name: "Demo aplikasi" }).waitFor();
  await page.reload();
  await page.getByRole("link", { name: "https://example.test/demo" }).waitFor();
  console.log("UI: HTTPS demo resource persists after reload");


  await p.goto(`${url}/proyek/${project.id}/ekspor`);
  const csvPromise = p.waitForEvent("download");
  await p.getByRole("button", { name: "Revisi CSV", exact: true }).click();
  const csv = await csvPromise;
  assert.equal(csv.suggestedFilename(), "revisi.csv");
  console.log("UI: authorized CSV download passed");
  const zipPromise = p.waitForEvent("download");
  await p
    .getByRole("button", { name: "Backup ZIP + file asli", exact: true })
    .click();
  const zip = await zipPromise;
  const archive = unzipSync(await readFile(await zip.path()));
  const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
  assert.equal(manifest.files.length, 2);
  assert.equal(
    Object.keys(archive).filter((n) => n.endsWith(".pdf")).length,
    2,
  );
  const meta = JSON.parse(strFromU8(archive["metadata.json"]));
  assert.equal(meta.versions.length, 2);
  assert.ok(!("private_notes" in meta));
  assert.ok(!("session" in meta));
  console.log(
    "UI: ZIP backup contains both original PDFs and authorized metadata manifest",
  );
  // The discussion unmounted above. No polling should continue from that thread.
  const previous = polls;
  await new Promise((r) => setTimeout(r, 16000));
  assert.equal(polls, previous);
  console.log("UI: inactive threads stop polling");
  assert.deepEqual(errors, []);
  console.log("UI: no uncaught browser errors");
} catch (e) {
  console.error("UI failed", e);
  for (const c of browser.contexts())
    for (const q of c.pages())
      console.error(
        q.url(),
        (await q.locator("body").innerText()).slice(-2800),
      );
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await db.close();
}
