// Browser acceptance against the SQL adapter: synthetic Auth and in-memory Storage,
// actual app build and PDF.js worker, actual SQL migrations/RLS. Never Google OAuth.
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import http from "node:http";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHmac, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { brotliDecompressSync } from "node:zlib";
import { chromium } from "playwright-core";
import binary from "@sparticuz/chromium";
import { db, rest } from "./sql-adapter.mjs";
import { rehearseBackup } from "../../scripts/lib/backup-restore.mjs";
import { pdfFixture } from "./pdf-fixture.mjs";
import { exerciseBrowserPdfFlow } from "../../scripts/lib/hosted-browser-qa.mjs";
const localBrowser = process.env.BIMBINGTA_UI_BROWSER;
if (!localBrowser && process.platform !== "linux")
  throw new Error("Set BIMBINGTA_UI_BROWSER to an installed Chromium browser executable on this platform.");
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
  student = { id: randomUUID(), email: "student.ui@example.test" },
  browserStudent = { id: randomUUID(), email: "browser.ui@example.test" };
for (const p of [owner, student, browserStudent]) {
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
const root = fileURLToPath(new URL("../../dist-harness/", import.meta.url));
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
if (!localBrowser) {
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
}
const browser = await chromium.launch({
  executablePath: localBrowser || "/tmp/chromium",
  // Single-process Chromium shares session state across test contexts; use
  // separate renderer processes so owner and student remain distinct actors.
  args: localBrowser ? [] : binary.args.filter((a) => !a.includes("disable-web-security") && a !== "--single-process"),
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
try {
  const browserInvite = await rest(owner.token, "POST", "/invitations", { normalized_email: browserStudent.email });
  assert.equal(browserInvite.status, 201);
  const browserProject = await rest(owner.token, "POST", "/projects", {
    invitation_id: browserInvite.json[0].id, title: "Synthetic browser flow rehearsal",
  });
  assert.equal(browserProject.status, 201);
  assert.equal((await rest(browserStudent.token, "POST", "/rpc/claim_membership", {})).status, 200);
  let browserFinding;
  // Use the HTTP adapter's queue while the UI is active; direct DB calls could
  // otherwise overlap its transaction on the same disposable connection.
  const browserRequest = async (person, method, path, body) => {
    const response = await fetch(url + "/rest/v1/" + path, {
      method, headers: { Authorization: "Bearer " + person.token, apikey: "test-only", "Content-Type": "application/json", Prefer: "return=representation" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };
  const readBrowser = async (path) => {
    const result = await browserRequest(browserStudent, "GET", path);
    assert.equal(result.status, 200);
    return result.json;
  };
  const browserApi = {
    version: async (sequence) => (await readBrowser(`versions?project_id=eq.${browserProject.json[0].id}&sequence=eq.${sequence}`))[0],
    pages: (id) => readBrowser(`pages?version_id=eq.${id}`),
    ranges: (id) => readBrowser(`chapter_ranges?version_id=eq.${id}`),
    setupFinding: async (id) => {
      const result = await browserRequest(owner, "POST", "findings", {
        project_id: browserProject.json[0].id, version_id: id, title: "Validasi PDF browser sintetis",
        chapter: "B1", locator: { pdf_page: 1 }, acceptance_criterion: "Ajukan versi baru", evidence_type: "manual",
      });
      assert.equal(result.status, 201); browserFinding = result.json[0];
    },
    finding: async () => (await readBrowser(`findings?id=eq.${browserFinding.id}`))[0],
    closeDenied: async (row) => {
      const result = await browserRequest(browserStudent, "POST", "rpc/finding_transition", {
        p_finding: row.id, p_expected: row.row_version, p_status: "verified_closed",
      });
      return result.status === 403 && result.json?.code === "42501";
    },
  };
  const browserFlowPage = await login(browserStudent, 390);
  let markDraftReady, releaseDraft, holdDraft = true;
  const draftReady = new Promise((resolve) => { markDraftReady = resolve; });
  const draftRelease = new Promise((resolve) => { releaseDraft = resolve; });
  await browserFlowPage.route(url + "/rest/v1/workspace_drafts**", async (route) => {
    if (holdDraft && route.request().method() === "GET") {
      holdDraft = false; markDraftReady(); await draftRelease;
    }
    await route.continue();
  });
  const browserFlowPromise = exerciseBrowserPdfFlow(browserFlowPage, {
    origin: url, projectId: browserProject.json[0].id, otherProjectId: project.id, userId: browserStudent.id,
    api: browserApi, freshPage: () => login(browserStudent, 390),
  });
  try {
    await draftReady;
    await browserFlowPage.getByLabel("Unggah naskah", { exact: true }).waitFor();
    assert.equal(await browserFlowPage.getByLabel("Unggah naskah", { exact: true }).isDisabled(), true);
    assert.equal((await readBrowser(`versions?project_id=eq.${browserProject.json[0].id}`)).length, 0);
  } finally { releaseDraft(); }
  const browserFlow = await browserFlowPromise;
  assert.equal(browserFlow.cases_passed, 18);
  await browserFlowPage.context().close();
  console.log("UI: shared hosted-browser flow waits for a delayed upload draft; PDF render/extract/seal/reload/proof, fresh session context and cross-project denial pass (synthetic services)");

  // Delay a real owner membership response while another tab switches to the
  // student. A completed request must not restore the previous account's UI.
  const racePage = await login(owner);
  await racePage.goto(`${url}/proyek/${project.id}/keterlacakan`);
  await racePage.getByRole("link", { name: "Mahasiswa", exact: true }).first().waitFor();
  const broadcastSession = async (person) => racePage.evaluate((p) => {
    const session = {
      access_token: p.token, refresh_token: "synthetic", token_type: "bearer",
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: p.id, email: p.email, aud: "authenticated", role: "authenticated",
        app_metadata: { provider: "google" }, user_metadata: {} },
    };
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    const channel = new BroadcastChannel("sb-127-auth-token");
    channel.postMessage({ event: "SIGNED_IN", session });
    channel.close();
  }, person);
  let markOldClaimReady, releaseOldClaim, holdNextClaim = true;
  const oldClaimReady = new Promise((resolve) => { markOldClaimReady = resolve; });
  const releaseSignal = new Promise((resolve) => { releaseOldClaim = resolve; });
  await racePage.route("**/rest/v1/rpc/claim_membership", async (route) => {
    if (!holdNextClaim) { await route.continue(); return; }
    holdNextClaim = false;
    const response = await route.fetch();
    markOldClaimReady();
    await releaseSignal;
    await route.fulfill({ response });
  });
  await broadcastSession(owner);
  await oldClaimReady;
  await broadcastSession(student);
  await racePage.getByRole("link", { name: "Proyek saya", exact: true }).first().waitFor();
  const oldResponseReceived = racePage.waitForResponse("**/rest/v1/rpc/claim_membership");
  releaseOldClaim();
  await (await oldResponseReceived).finished();
  await racePage.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  assert.equal(await racePage.getByRole("link", { name: "Mahasiswa", exact: true }).count(), 0,
    "late owner claim must not replace student membership");
  assert.ok(await racePage.getByRole("link", { name: "Proyek saya", exact: true }).count());
  await racePage.context().close();
  console.log("UI: account switch ignores a delayed previous-account membership response");

  // An interrupted multi-request extraction leaves a valid partial page set.
  // Resume must add missing pages without changing existing manual text/labels.
  const partialInvite = await rest(owner.token, "POST", "/invitations", {
    normalized_email: "partial.pdf.ui@example.test",
  });
  assert.equal(partialInvite.status, 201);
  const partialProject = await rest(owner.token, "POST", "/projects", {
    title: "Synthetic interrupted PDF recovery", invitation_id: partialInvite.json[0].id,
  });
  assert.equal(partialProject.status, 201);
  const partialBytes = pdfFixture();
  const partialUpload = await rest(owner.token, "POST", "/versions", {
    project_id: partialProject.json[0].id, file_name: "partial.pdf",
    file_size: partialBytes.length, mime_type: "application/pdf",
  });
  assert.equal(partialUpload.status, 201);
  let partialVersion = partialUpload.json[0];
  await as(owner.token, () => exec(
    "insert into storage.objects(bucket_id,name,metadata) values('thesis-files',$1,$2)",
    [partialVersion.file_path, { size: partialBytes.length, mimetype: "application/pdf" }],
  ));
  blobs.set(partialVersion.file_path, partialBytes);
  const partialFinalize = await rest(owner.token, "POST", "/rpc/version_upload_result", {
    p_version: partialVersion.id, p_expected: partialVersion.row_version,
    p_hash: createHash("sha256").update(partialBytes).digest("hex"),
  });
  assert.equal(partialFinalize.status, 200);
  partialVersion = partialFinalize.json[0];
  const preservedText = "Teks manual yang harus dipertahankan";
  const partialSave = await rest(owner.token, "POST", "/rpc/version_save_pages", {
    p_version: partialVersion.id, p_expected: partialVersion.row_version,
    p_page_count: 2,
    p_pages: [{ pdf_page: 1, printed_label: "i", text: preservedText, source: "pasted" }],
  });
  assert.equal(partialSave.status, 200);
  const preservedPage = (await exec("select * from pages where version_id=$1 and pdf_page=1",
    [partialVersion.id])).rows[0];
  const recoveryPage = await login(owner);
  await recoveryPage.goto(`${url}/proyek/${partialProject.json[0].id}/naskah`);
  await recoveryPage.getByLabel("Teks hasil ekstraksi / tempel teks").waitFor();
  const resumePages = recoveryPage.getByRole("button", {
    name: "Lengkapi halaman untuk teks manual", exact: true,
  });
  assert.equal(await resumePages.count(), 1,
    "partially saved PDF pages must retain a manual recovery action");
  // A failed retry must keep the recovery action and preserve the first page.
  await recoveryPage.route("**/rest/v1/rpc/version_save_pages", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ message: "Simulasi penyimpanan halaman gagal" }) });
  }, { times: 1 });
  await resumePages.click();
  await recoveryPage.getByRole("alert").filter({ hasText: "Simulasi penyimpanan halaman gagal" }).waitFor();
  assert.deepEqual((await exec("select * from pages where version_id=$1 and pdf_page=1",
    [partialVersion.id])).rows[0], preservedPage);
  assert.equal(await resumePages.count(), 1);
  await resumePages.click();
  await recoveryPage.waitForFunction(() => ![...document.querySelectorAll("button")]
    .some((b) => b.textContent === "Lengkapi halaman untuk teks manual"));
  assert.deepEqual((await exec("select * from pages where version_id=$1 and pdf_page=1",
    [partialVersion.id])).rows[0], preservedPage);
  const completedPages = (await exec("select pdf_page,text,source from pages where version_id=$1 order by pdf_page",
    [partialVersion.id])).rows;
  assert.deepEqual(completedPages, [
    { pdf_page: 1, text: preservedText, source: "pasted" },
    { pdf_page: 2, text: "", source: "pasted" },
  ]);
  assert.equal((await exec("select status from versions where id=$1", [partialVersion.id])).rows[0].status, "extracted");
  await recoveryPage.reload();
  await recoveryPage.waitForFunction((text) =>
    document.querySelector('textarea[rows="8"]')?.value === text, preservedText);
  await recoveryPage.context().close();
  console.log("UI: interrupted manual PDF page setup resumes without changing existing text, label, hash or row version");

  const notePage = await login(owner);
  await notePage.goto(`${url}/proyek/${project.id}/catatan`);
  const noteInput = notePage.getByTestId("private-notes").locator("textarea");
  await noteInput.waitFor();
  let markFirstNoteReady, releaseFirstNote, holdFirstNote = true;
  const firstNoteReady = new Promise((resolve) => { markFirstNoteReady = resolve; });
  const releaseNoteSignal = new Promise((resolve) => { releaseFirstNote = resolve; });
  await notePage.route("**/rest/v1/private_notes**", async (route) => {
    if (route.request().method() !== "PATCH" || !holdFirstNote) {
      await route.continue(); return;
    }
    holdFirstNote = false;
    // The first save commits in SQL, but the client cannot see its new version yet.
    const response = await route.fetch();
    markFirstNoteReady();
    await releaseNoteSignal;
    await route.fulfill({ response });
  });
  const isNoteSave = (response, body) => response.request().method() === "PATCH"
    && response.url().includes("/rest/v1/private_notes")
    && response.request().postDataJSON()?.body === body;
  const firstNoteText = "Catatan pertama dengan respons tertunda";
  const newestNoteText = "Catatan terbaru yang diketik saat respons pertama tertunda";
  const firstNoteResponse = notePage.waitForResponse((r) => isNoteSave(r, firstNoteText));
  const newestNoteResponse = notePage.waitForResponse((r) => isNoteSave(r, newestNoteText));
  await noteInput.fill(firstNoteText);
  await firstNoteReady;
  await noteInput.fill(newestNoteText);
  // Keep the response withheld past the application's 1,200 ms debounce.
  await notePage.waitForTimeout(1500);
  releaseFirstNote();
  await (await firstNoteResponse).finished();
  await (await newestNoteResponse).finished();
  await notePage.getByTestId("private-notes").getByText(/^Tersimpan /).waitFor();
  assert.equal((await exec("select body from private_notes where project_id=$1",
    [project.id])).rows[0].body, newestNoteText,
  "a slow autosave must retain newer edits instead of reporting false success");
  await notePage.reload();
  await notePage.waitForFunction((text) =>
    document.querySelector('[data-testid="private-notes"] textarea')?.value === text, newestNoteText);

  // Serializing one tab must preserve genuine optimistic conflicts across tabs.
  const staleNotePage = await login(owner);
  await staleNotePage.goto(`${url}/proyek/${project.id}/catatan`);
  await staleNotePage.getByTestId("private-notes").locator("textarea").waitFor();
  const winnerText = "Catatan yang disimpan tab pertama";
  const winnerResponse = notePage.waitForResponse((r) => isNoteSave(r, winnerText));
  await notePage.getByTestId("private-notes").locator("textarea").fill(winnerText);
  await (await winnerResponse).finished();
  const loserText = "Catatan lama dari tab kedua";
  const loserResponse = staleNotePage.waitForResponse((r) => isNoteSave(r, loserText));
  await staleNotePage.getByTestId("private-notes").locator("textarea").fill(loserText);
  await (await loserResponse).finished();
  await staleNotePage.getByRole("alert").filter({ hasText: "Konflik: data diubah di sesi lain." }).waitFor();
  assert.equal((await exec("select body from private_notes where project_id=$1",
    [project.id])).rows[0].body, winnerText);
  await staleNotePage.getByRole("button", { name: "Muat versi terbaru", exact: true }).click();
  await staleNotePage.waitForFunction((text) =>
    document.querySelector('[data-testid="private-notes"] textarea')?.value === text, winnerText);
  await staleNotePage.context().close();
  await notePage.context().close();
  console.log("UI: slow autosave retains latest edits; real two-tab conflict is preserved and reload resolves it");

  const navigationPage = await login(owner);
  const projectA = project.id, projectB = partialProject.json[0].id;
  const originalProjectA = (await exec("select * from projects where id=$1", [projectA])).rows[0];
  await navigationPage.goto(`${url}/proyek/${projectA}/ringkasan`);
  await navigationPage.getByRole("heading", { name: project.title, exact: true }).waitFor();
  const navigateProject = (id) => navigationPage.evaluate((nextId) => {
    window.history.pushState({ ...window.history.state,
      idx: (window.history.state?.idx || 0) + 1, key: crypto.randomUUID() },
    "", `/proyek/${nextId}/ringkasan`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, id);
  const isProjectRead = (r, id) => r.request().method() === "GET"
    && new URL(r.url()).pathname === "/rest/v1/projects"
    && new URL(r.url()).searchParams.get("id") === `eq.${id}`;
  const holdProjectRead = async (id, fail = false) => {
    let ready, release, held = false;
    const responseReady = new Promise((resolve) => { ready = resolve; });
    const releaseSignal = new Promise((resolve) => { release = resolve; });
    await navigationPage.route("**/rest/v1/projects?**", async (route) => {
      if (held || route.request().method() !== "GET"
        || new URL(route.request().url()).searchParams.get("id") !== `eq.${id}`) {
        await route.continue(); return;
      }
      held = true;
      const response = await route.fetch();
      ready();
      await releaseSignal;
      if (fail) await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ message: "Simulasi proyek lama gagal dimuat" }) });
      else await route.fulfill({ response });
    });
    return { ready: responseReady, release };
  };
  const heldB = await holdProjectRead(projectB);
  const readBResponse = navigationPage.waitForResponse((r) => isProjectRead(r, projectB));
  await navigateProject(projectB);
  await heldB.ready;
  const staleProjectVisible = await navigationPage.getByRole("heading", {
    name: project.title, exact: true,
  }).count();
  const staleFormVisible = await navigationPage.getByTestId("project-summary").count();
  heldB.release();
  await (await readBResponse).finished();
  assert.equal(staleProjectVisible, 0, "old project metadata must disappear while the new route loads");
  assert.equal(staleFormVisible, 0, "old editable forms must not remain active under the new project URL");
  await navigationPage.getByRole("heading", { name: partialProject.json[0].title, exact: true }).waitFor();
  await navigationPage.getByText("partial.pdf.ui@example.test", { exact: true }).waitFor();
  for (const failOldProject of [false, true]) {
    const heldA = await holdProjectRead(projectA, failOldProject);
    const oldReadResponse = navigationPage.waitForResponse((r) => isProjectRead(r, projectA));
    await navigateProject(projectA);
    await heldA.ready;
    await navigateProject(projectB);
    await navigationPage.getByRole("heading", { name: partialProject.json[0].title, exact: true }).waitFor();
    await navigationPage.getByText("partial.pdf.ui@example.test", { exact: true }).waitFor();
    const summaryB = `Ringkasan proyek B: respons A ${failOldProject ? "gagal" : "berhasil"} diabaikan`;
    const summarySaved = navigationPage.waitForResponse((r) => r.request().method() === "PATCH"
      && new URL(r.url()).pathname === "/rest/v1/projects"
      && new URL(r.url()).searchParams.get("id") === `eq.${projectB}`
      && r.request().postDataJSON()?.summary === summaryB);
    await navigationPage.getByTestId("project-summary").fill(summaryB);
    heldA.release();
    await (await oldReadResponse).finished();
    await navigationPage.waitForTimeout(100);
    assert.equal(await navigationPage.getByRole("heading", {
      name: partialProject.json[0].title, exact: true,
    }).count(), 1, "late old-project success/error must not replace the current project");
    assert.equal(await navigationPage.getByTestId("project-summary").inputValue(), summaryB);
    await (await summarySaved).finished();
    assert.equal((await exec("select summary from projects where id=$1", [projectB])).rows[0].summary, summaryB);
  }
  assert.deepEqual((await exec("select * from projects where id=$1", [projectA])).rows[0], originalProjectA);
  await navigationPage.context().close();
  console.log("UI: project navigation hides stale forms, ignores old success/error responses and saves only the current project's edits");

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

  const qaDir = join(root, "qa");
  await mkdir(qaDir, { recursive: true });
  for (const width of [1280, 390, 320]) {
    await traceOwner.setViewportSize({ width, height: 900 });
    const table = await traceOwner.locator("table").boundingBox();
    const editor = await traceOwner.locator('td[colspan="5"]').boundingBox();
    assert.ok(table && editor && Math.abs(table.width - editor.width) < 2,
      "Traceability editor must span the full table width");
    assert.equal(await traceOwner.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth), true,
      "Table overflow must stay inside its scroll container");
    const form = await traceOwner.locator('td[colspan="5"] details > div').boundingBox();
    assert.ok(form && form.x >= 0 && form.x + form.width <= width,
      "Editor form must fit the viewport without horizontal scrolling");
    if (width >= 768)
      assert.ok(form.width >= table.width - 28,
        "Desktop editor form must retain the full available table width");
    for (const control of await traceOwner.locator('td[colspan="5"] input, td[colspan="5"] textarea, td[colspan="5"] select, td[colspan="5"] button').all()) {
      const box = await control.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width,
        "Editor inputs and save button must stay within the viewport");
    }
    assert.equal(await traceOwner.getByLabel(/^Catatan pembimbing/).inputValue(), traceNote);
    await traceOwner.screenshot({
      path: join(qaDir, `traceability-${width}.png`), fullPage: true,
    });
  }
  console.log("UI: traceability editor spans the table at desktop/mobile widths; screenshots saved in dist-harness/qa");

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
  const backupBytes = await readFile(await zip.path());
  await mkdir(join(root, "qa"), { recursive: true });
  await writeFile(join(root, "qa", "workspace-backup.zip"), backupBytes);
  const restoreReport = await rehearseBackup(backupBytes);
  assert.equal(restoreReport.passed, true);
  assert.equal(restoreReport.pdf_files, 2);
  assert.equal(restoreReport.rollback_verified, true);
  await writeFile(join(root, "qa", "restore-report.json"), JSON.stringify(restoreReport, null, 2));
  console.log("UI: actual exported ZIP restored into disposable SQL with both PDFs verified; rollback passed (not hosted)");
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
