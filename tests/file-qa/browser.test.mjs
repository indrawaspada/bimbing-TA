import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserEnvironment, browserRequestAllowed, verifyPreviewBuild } from '../../scripts/lib/hosted-browser-qa.mjs';

test('browser process receives OS paths but never admin/provider/Auth secrets', () => {
  const env = browserEnvironment({ PATH: '/usr/bin', SystemRoot: 'C:/Windows', TEMP: '/tmp',
    SUPABASE_DB_URL: 'private-db', SUPABASE_SERVICE_ROLE_KEY: 'private-admin', OPENAI_API_KEY: 'private-provider',
    GITHUB_TOKEN: 'private-github', VITE_SUPABASE_ANON_KEY: 'public-but-unneeded', JWT: 'private-user' });
  assert.deepEqual(env, { PATH: '/usr/bin', SystemRoot: 'C:/Windows', TEMP: '/tmp' });
});

test('browser network is pinned to preview and DEV manual APIs; provider/function/foreign URLs are denied', () => {
  assert.equal(browserRequestAllowed('https://codex-checkpoint-d.bimbing-ta.pages.dev/assets/index-a.js'), true);
  assert.equal(browserRequestAllowed('https://tghcovjdsxirhpexpqor.supabase.co/rest/v1/rpc/version_confirm', 'POST'), true);
  assert.equal(browserRequestAllowed('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap'), true);
  assert.equal(browserRequestAllowed('https://fonts.gstatic.com/s/plusjakartasans/v12/fixture.woff2'), true);
  assert.equal(browserRequestAllowed('https://fonts.gstatic.com/s/other/v12/fixture.woff2'), false);
  assert.equal(browserRequestAllowed('https://fonts.gstatic.com/s/plusjakartasans/v12/fixture.woff2?token=private'), false);
  for (const url of ['https://api.openai.com/v1/responses', 'https://other.supabase.co/rest/v1/projects',
    'https://tghcovjdsxirhpexpqor.supabase.co/functions/v1/ai',
    'https://codex-checkpoint-d.bimbing-ta.pages.dev/?token=private',
    'http://tghcovjdsxirhpexpqor.supabase.co/rest/v1/projects'])
    assert.equal(browserRequestAllowed(url, 'POST'), false);
});

test('preview entry assets must match the reviewed build; foreign scripts or another build stop before fixtures', async () => {
  const html = '<script type="module" src="/assets/index-a.js"></script><link rel="stylesheet" href="/assets/index-a.css">';
  const response = (body) => async (url, options) => {
    assert.equal(url, 'https://codex-checkpoint-d.bimbing-ta.pages.dev/');
    assert.equal(options.redirect, 'error');
    return { status: 200, text: async () => body };
  };
  assert.deepEqual(await verifyPreviewBuild(html, response(html)), { preview_build_verified: true });
  await assert.rejects(verifyPreviewBuild(html, response(html.replace('index-a.js', 'index-b.js'))),
    { code: 'browser_qa_preview_build_mismatch' });
  await assert.rejects(verifyPreviewBuild(html, response(html + '<script src="https://foreign.test/injected.js"></script>')),
    { code: 'browser_qa_unexpected_preview_assets' });
  const fonts = '<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet" />';
  assert.deepEqual(await verifyPreviewBuild(html + fonts, response(html + fonts)), { preview_build_verified: true });
  await assert.rejects(verifyPreviewBuild(html, response(html + '<link rel="stylesheet" href="https://foreign.test/injected.css">')),
    { code: 'browser_qa_unexpected_preview_assets' });
});
