// Real deployed preview UI with fixture-student Auth; no browser API responses are mocked.
import { chromium } from 'playwright-core';
import binary from '@sparticuz/chromium';
import { pdfFixture } from '../../tests/workspace/pdf-fixture.mjs';
import { digest } from './backup-restore.mjs';
import { FILE_QA_REF, FileQaError } from './hosted-file-qa.mjs';
export const BROWSER_QA_ORIGIN = 'https://codex-checkpoint-d.bimbing-ta.pages.dev';
const SUPABASE_ORIGIN = 'https://' + FILE_QA_REF + '.supabase.co';
const FONT_STYLESHEET = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const check = (ok, code) => { if (!ok) throw new FileQaError(code); };

export function browserEnvironment(env = process.env) {
  const allowed = new Set(['PATH','TEMP','TMP','TMPDIR','HOME','USERPROFILE','SYSTEMROOT','WINDIR','LD_LIBRARY_PATH','FONTCONFIG_PATH']);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key.toUpperCase())));
}

export function browserRequestAllowed(url, method = 'GET') {
  const target = new URL(url);
  if (target.origin === BROWSER_QA_ORIGIN) return !target.search && ['GET','HEAD'].includes(method);
  if (['GET','HEAD'].includes(method)) {
    if (target.href === FONT_STYLESHEET) return true;
    if (target.origin === 'https://fonts.gstatic.com' && !target.search
      && /^\/s\/(plusjakartasans|jetbrainsmono)\/v[0-9]+\/[a-zA-Z0-9_-]+\.(woff2|ttf)$/.test(target.pathname)) return true;
  }
  if (target.origin !== SUPABASE_ORIGIN) return false;
  return /^\/(auth|rest|storage)\/v1\//.test(target.pathname);
}

function entryAssets(html) {
  check(typeof html === 'string' && html.length < 32768, 'browser_qa_invalid_preview_html');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  const styles = [...html.matchAll(/<link\b[^>]*>/g)].filter((m) => /\brel="stylesheet"/.test(m[0]))
    .map((m) => m[0].match(/\bhref="([^"]+)"/)?.[1]);
  const appStyles = styles.filter((src) => /^\/assets\/index-[a-zA-Z0-9_-]+\.css$/.test(src || ''));
  check(scripts.length === 1 && /^\/assets\/index-[a-zA-Z0-9_-]+\.js$/.test(scripts[0])
    && appStyles.length === 1 && styles.every((src) => src === appStyles[0] || src === FONT_STYLESHEET),
    'browser_qa_unexpected_preview_assets');
  return [...scripts, ...styles];
}

export async function verifyPreviewBuild(expectedHtml, fetcher = fetch) {
  const response = await fetcher(BROWSER_QA_ORIGIN + '/', { redirect: 'error', signal: AbortSignal.timeout(20000) });
  check(response.status === 200, 'browser_qa_preview_unavailable');
  check(JSON.stringify(entryAssets(await response.text())) === JSON.stringify(entryAssets(expectedHtml)), 'browser_qa_preview_build_mismatch');
  return { preview_build_verified: true };
}

// Shared UI flow is also exercised locally against the actual SQL/RLS adapter.
export async function exerciseBrowserPdfFlow(page, { origin, projectId, otherProjectId, userId, api, freshPage }) {
  check(origin === BROWSER_QA_ORIGIN || /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin), 'browser_qa_invalid_origin');
  check([projectId, otherProjectId, userId].every((id) => UUID.test(id)) && projectId !== otherProjectId, 'browser_qa_invalid_scope');
  const checks = [], versions = [];
  const record = (name, ok) => { check(ok, name); checks.push(name); };
  let stage = 'open';
  try {
    await page.goto(origin + '/proyek/' + projectId + '/naskah');
    await page.getByLabel('Unggah naskah', { exact: true }).waitFor();
    record('browser_student_own_workspace', page.url().includes('/proyek/' + projectId + '/'));
    record('browser_private_note_navigation_absent', await page.getByRole('link', { name: 'Catatan privat', exact: true }).count() === 0);
    for (const sequence of [1, 2]) {
      stage = 'upload_ready_v' + sequence;
      // setInputFiles does not wait for enabled actionability. Hosted draft reads
      // are slower than local SQL, so wait for the app's own readiness gate.
      await page.waitForFunction(() => {
        const input = document.querySelector('input[type="file"]');
        return input && !input.disabled;
      });
      stage = 'upload_v' + sequence;
      const bytes = pdfFixture(sequence), suffix = sequence === 2 ? ' revisi' : '';
      const texts = ['Bab I Pendahuluan' + suffix, 'Bab III Metode validasi' + suffix];
      await page.getByLabel('Unggah naskah', { exact: true }).setInputFiles({
        name: 'browser-v' + sequence + '.pdf', mimeType: 'application/pdf', buffer: bytes,
      });
      const extract = page.getByRole('button', { name: 'Ekstrak teks PDF', exact: true });
      await extract.waitFor();
      stage = 'render_v' + sequence;
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas?.width || !canvas.height) return false;
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 4)
          if (data[i + 3] === 255 && data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) return true;
        return false;
      });
      let version = await api.version(sequence);
      record('browser_pdf_upload_metadata_v' + sequence, version.project_id === projectId && version.submitted_by === userId
        && version.file_hash === digest(bytes) && Number(version.file_size) === bytes.length);
      record('browser_pdf_canvas_render_v' + sequence, true);
      stage = 'extract_v' + sequence;
      await extract.click();
      await page.waitForFunction((text) => document.querySelector('textarea[rows="8"]')?.value === text, texts[0]);
      const pages = await api.pages(version.id);
      record('browser_pdfjs_extraction_v' + sequence, pages.length === 2 && pages.every((p, i) =>
        p.pdf_page === i + 1 && p.text === texts[i] && p.source === 'pdfjs' && p.text_hash === digest(Buffer.from(p.text))));
      stage = 'ranges_v' + sequence;
      await page.getByLabel('B1 awal', { exact: true }).fill('1');
      await page.getByLabel('B1 akhir', { exact: true }).fill('2');
      await page.getByRole('button', { name: 'Terapkan rentang bab', exact: true }).click();
      await page.getByRole('checkbox').waitFor();
      // Wait for the apply request to finish before checking the saved ranges.
      await page.waitForFunction(() => ![...document.querySelectorAll('button')]
        .some((b) => b.textContent.includes('Terapkan rentang bab') && b.disabled));
      const ranges = await api.ranges(version.id);
      record('browser_chapter_ranges_v' + sequence, ranges.length === 1 && ranges[0].chapter === 'B1'
        && ranges[0].start_page === 1 && ranges[0].end_page === 2 && ranges[0].confirmed === false);
      stage = 'seal_v' + sequence;
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Konfirmasi dan kunci versi', exact: true }).click();
      await page.getByText('Versi telah dikonfirmasi.', { exact: false }).waitFor();
      version = await api.version(sequence);
      const sealedRanges = await api.ranges(version.id);
      record('browser_sealed_snapshot_v' + sequence, version.status === 'confirmed' && version.page_count === 2
        && version.confirmed_by === userId && /^[a-f0-9]{64}$/.test(version.extraction_hash)
        && sealedRanges.length === 1 && sealedRanges[0].confirmed === true);
      versions.push(version);
      await page.reload();
      await page.getByLabel('Pilih versi naskah').selectOption(version.id);
      await page.waitForFunction((text) => document.querySelector('textarea[rows="8"]')?.value === text, texts[0]);
      record('browser_sealed_reload_readonly_v' + sequence,
        await page.getByLabel('Teks hasil ekstraksi / tempel teks').getAttribute('readonly') !== null);
      if (sequence === 1) await api.setupFinding(version.id);
    }
    stage = 'revision_proof';
    await page.goto(origin + '/proyek/' + projectId + '/revisi');
    await page.getByRole('button', { name: 'Mulai kerjakan', exact: true }).click();
    await page.getByRole('button', { name: 'Ajukan bukti perbaikan', exact: true }).click();
    await page.getByLabel('Versi bukti').selectOption(versions[1].id);
    await page.getByLabel('PDF asli halaman awal').fill('2');
    await page.getByLabel('PDF asli halaman akhir').fill('2');
    await page.getByLabel('Perbaikan yang memenuhi kriteria').fill('Bukti versi kedua dari uji browser sintetis');
    await page.getByRole('button', { name: 'Ajukan kepada dosen', exact: true }).click();
    await page.locator('span').filter({ hasText: /^Diajukan$/ }).waitFor();
    const finding = await api.finding();
    record('browser_new_version_proof_submitted', finding.workflow_status === 'submitted'
      && finding.revision_proof?.version_id === versions[1].id && finding.revision_proof?.submitted_by === userId
      && finding.revision_proof?.file_hash === versions[1].file_hash
      && finding.revision_proof?.extraction_hash === versions[1].extraction_hash
      && finding.revision_proof?.start_page === 2 && finding.revision_proof?.end_page === 2);
    record('browser_student_close_denied', await page.getByRole('button', { name: 'Verifikasi selesai', exact: true }).count() === 0
      && await api.closeDenied(finding));
    stage = 'fresh_context';
    const fresh = await freshPage();
    await fresh.goto(origin + '/proyek/' + projectId + '/naskah');
    await fresh.getByLabel('Pilih versi naskah').selectOption(versions[1].id);
    await fresh.waitForFunction(() => document.querySelector('textarea[rows="8"]')?.value === 'Bab I Pendahuluan revisi');
    check(await fresh.getByLabel('Teks hasil ekstraksi / tempel teks').getAttribute('readonly') !== null, 'browser_fresh_context_not_sealed');
    await fresh.goto(origin + '/proyek/' + projectId + '/revisi');
    await fresh.locator('span').filter({ hasText: /^Diajukan$/ }).waitFor();
    record('browser_fresh_context_persists_pdf_and_proof', true);
    stage = 'cross_project';
    await fresh.goto(origin + '/proyek/' + otherProjectId + '/naskah');
    await fresh.getByText('Proyek tidak ditemukan', { exact: true }).waitFor();
    record('browser_cross_project_denied', await fresh.getByLabel('Unggah naskah', { exact: true }).count() === 0);
    await fresh.context().close();
    return { cases_passed: checks.length, checks, versions_created: 2, pages_per_version: 2,
      browser_extraction_tested: true, browser_pdf_render_tested: true, google_oauth_tested: false,
      fresh_issued_session_context_tested: true, provider_called: false, ai_enabled: false };
  } catch (error) {
    if (error instanceof FileQaError) throw error;
    // Playwright messages/URLs may contain session information; never print them.
    throw new FileQaError('browser_qa_' + stage + '_failed');
  }
}

export async function runHostedBrowserPdf(fixture) {
  check(fixture.session?.user?.id === fixture.userId && fixture.session?.access_token?.split('.').length === 3,
    'browser_qa_fixture_session_required');
  let browser, blocked = false, pageError = false;
  try {
    const executablePath = process.env.BIMBINGTA_UI_BROWSER || await binary.executablePath();
    browser = await chromium.launch({ executablePath, headless: true, env: browserEnvironment(),
      args: process.env.BIMBINGTA_UI_BROWSER ? [] : binary.args.filter((a) =>
        !a.includes('disable-web-security') && a !== '--single-process') });
    const newPage = async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', async (route) => {
        if (!browserRequestAllowed(route.request().url(), route.request().method())) {
          blocked = true; await route.abort();
        } else await route.continue();
      });
      await context.addInitScript((session) => localStorage.setItem('sb-tghcovjdsxirhpexpqor-auth-token', JSON.stringify(session)), fixture.session);
      const page = await context.newPage();
      page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(45000);
      page.on('pageerror', () => { pageError = true; });
      return page;
    };
    const result = await exerciseBrowserPdfFlow(await newPage(), { ...fixture, origin: BROWSER_QA_ORIGIN, freshPage: newPage });
    check(!blocked, 'browser_qa_unexpected_network_request');
    check(!pageError, 'browser_qa_uncaught_browser_error');
    result.checks.push('browser_requests_pinned_no_provider_endpoint', 'browser_no_uncaught_errors');
    return { ...result, cases_passed: result.checks.length, browser_api_mocking: false,
      fixture_memberships_enrolled_by_sql: true, auth_issued_jwts: true };
  } catch (error) {
    if (error instanceof FileQaError) throw error;
    throw new FileQaError('browser_qa_launch_or_operation_failed');
  } finally { await browser?.close(); }
}
