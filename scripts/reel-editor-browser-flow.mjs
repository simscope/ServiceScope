// One ordinary-application browser scenario; no session/RPC mocks or file adapter.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { classifyBrowserRequest } from './reel-browser-request-guard.mjs';

export async function browserEditorFlow({ endpoint, anon, email, password, managerId, apiOrigin, browserMedia, privateFixtureUrl }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const evidence = resolve(process.env.REEL_BROWSER_EVIDENCE);
  assert(!relative(resolve(process.env.RUNNER_TEMP), evidence).startsWith('..'));
  await mkdir(evidence, { recursive: true });
  process.env.VITE_SUPABASE_URL = endpoint;
  process.env.VITE_SUPABASE_ANON_KEY = anon;
  let vite;
  let browser, page;
  const diagnostics = [];
  const safe = value => String(value).replaceAll(password, '[redacted]').replaceAll(anon, '[redacted]').replaceAll(email, '[redacted]').replace(/eyJ[\w.-]+/g, '[redacted]').replace(/https?:\/\/[^\s)]+/g, value => { try { const u = new URL(value); return u.origin + u.pathname; } catch { return '[url]'; } }).slice(0, 1500);
  const record = event => { if (diagnostics.length < 20) diagnostics.push({ stage, ...event }); };
  let forbidden, rejectForbidden, pageState;
  const forbiddenRequest = new Promise((_, reject) => { rejectForbidden = reject; });
  forbiddenRequest.catch(() => {});
  const counts = { render: 0, publication: 0, ai: 0, blockedExternal: 0, blockedUnknown: 0, blockedAttempts: 0, frontendModules: 0, providerRequestsSent: 0 };
  const results = {};
  const mediaResponses = new Map();
  const expectedMedia = new Set(browserMedia.map(m => m.url));
  let stage = 'launch';
  try {
    vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy: { '/api': apiOrigin } } });
    await vite.listen();
    const { chromium } = await import(pathToFileURL(process.env.REEL_BROWSER_MODULE).href);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1100 } });
    await context.route('**/*', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let action;
      if (request.method() === 'POST' && (pathname === '/api/reel-editor' || ['/functions/v1/meta-social-publish', '/functions/v1/meta-social-connection'].includes(pathname))) {
        try { const body = request.postDataJSON(); action = pathname === '/api/reel-editor' ? body?.operation : body?.action; } catch {}
      }
      const decision = classifyBrowserRequest({ url: request.url(), method: request.method(), resourceType: request.resourceType(), action }, { appOrigin: 'http://127.0.0.1:5189', backendOrigin: new URL(endpoint).origin });
      if (decision.decision === 'block') {
        counts.blockedAttempts++;
        const counter = { external: 'blockedExternal', unknown: 'blockedUnknown' }[decision.operation] || decision.operation;
        counts[counter]++;
        record({ event: 'routeblock', ...decision });
        forbidden ||= 'FORBIDDEN_OPERATION ' + decision.rule + ' ' + decision.method + ' ' + decision.origin + decision.pathname;
        await route.abort(); rejectForbidden(new Error(forbidden)); return;
      }
      if (decision.rule === 'frontend-module') counts.frontendModules++;
      await route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', error => record({ event: 'pageerror', condition: safe(error.message) }));
    page.on('requestfailed', request => {
      const u = new URL(request.url());
      record({ event: 'requestfailed', origin: u.origin, pathname: u.pathname, method: request.method(), resourceType: request.resourceType(), condition: safe(request.failure()?.errorText || 'unknown'), ...(request.resourceType() === 'image' ? { expectedFixture: expectedMedia.has(request.url()), ...(mediaResponses.get(request.url()) || {}) } : {}) });
    });
    page.on('response', response => {
      if (response.request().resourceType() === 'image') {
        const detail = { status: response.status(), contentType: response.headers()['content-type'] || '', expectedFixture: expectedMedia.has(response.url()) };
        mediaResponses.set(response.url(), detail);
        if (response.status() >= 400) { const u = new URL(response.url()); record({ event: 'image-http-error', origin: u.origin, pathname: u.pathname, method: response.request().method(), resourceType: 'image', ...detail }); }
      }
      if (response.status() < 400 || !['document', 'script'].includes(response.request().resourceType())) return;
      const u = new URL(response.url());
      record({ event: 'load-http-error', origin: u.origin, pathname: u.pathname, method: response.request().method(), resourceType: response.request().resourceType(), status: response.status() });
    });
    pageState = async function () {
      const u = new URL(page.url());
      return { url: u.origin + u.pathname, title: safe(await page.title()), rootPresent: await page.locator('#root').count() > 0,
        rootHasContent: await page.locator('#root').textContent().then(t => Boolean(t?.trim())).catch(() => false),
        loginLabels: await page.locator('label').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => n.textContent?.trim()).slice(0, 12)).then(rows => rows.map(safe)),
        visibleButtons: await page.getByRole('button').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => n.textContent?.trim()).slice(0, 12)).then(rows => rows.map(safe)) };
    };
    page.setDefaultTimeout(20000);
    // Keep only safe editor response bodies in memory, never headers/JWT/HAR.
    const responses = [];
    page.on('response', async response => {
      if (new URL(response.url()).pathname !== '/api/reel-editor') return;
      try { responses.push({ status: response.status(), operation: response.request().postDataJSON()?.operation, body: await response.json() }); } catch {}
    });
    async function clickOperation(button, operation) {
      const waiting = page.waitForResponse(r => new URL(r.url()).pathname === '/api/reel-editor' && r.request().postDataJSON()?.operation === operation);
      await button.click();
      const response = await waiting;
      const body = await response.json();
      assert.equal(response.status(), 200, `${operation} HTTP ${response.status()} code=${body.code}`);
      return body.row;
    }
    async function openEditor() {
      if (await page.getByRole('button', { name: 'Open manager photo editor', exact: true }).isVisible()) {
        await page.getByRole('button', { name: 'Open manager photo editor', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'All Jobs', exact: true }).click();
        const visibility = page.getByRole('combobox', { name: 'Job visibility' });
        if (await visibility.isVisible()) await visibility.selectOption('all');
        await page.getByRole('button').filter({ hasText: 'SYNTHETIC-BROWSER' }).click();
        await page.getByRole('button', { name: 'Open in AI Assistant', exact: true }).click();
        await page.getByRole('button', { name: 'Open manager photo editor', exact: true }).click();
      }
      await page.getByRole('region', { name: 'Manager Reel Editor' }).waitFor();
      return page.locator('.reel-manager-editor');
    }
    async function anonymousMediaGet(url) {
      const u = new URL(url);
      assert.equal(u.origin, new URL(endpoint).origin, 'MEDIA_OUTSIDE_TEST_BACKEND');
      assert(u.pathname.startsWith('/storage/v1/object/public/'), 'MEDIA_PATH_MISMATCH');
      // Deliberately no Authorization/apikey; redirect:error prevents external redirects.
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      let errorCode;
      if (!response.ok) { try { const body = JSON.parse(bytes.toString('utf8')); const value = body.error || body.code || body.statusCode; if (/^[A-Za-z0-9_ -]{1,64}$/.test(String(value))) errorCode = String(value); } catch {} }
      return { evidence: { origin: u.origin, pathname: u.pathname, status: response.status, contentType: response.headers.get('content-type'), png, ...(errorCode ? { errorCode } : {}) }, bytes };
    }
    stage = 'private fixture negative public GET';
    const privateGet = await anonymousMediaGet(privateFixtureUrl);
    results.privateFixturePublicGet = privateGet.evidence;
    assert(!privateGet.evidence.png && privateGet.evidence.status >= 400, 'PRIVATE_FIXTURE_PUBLIC_READ_UNEXPECTED');
    await Promise.race([forbiddenRequest, (async () => {
    stage = 'normal login';
    const document = await page.goto('http://127.0.0.1:5189/');
    results.documentStatus = document?.status();
    try { await page.getByLabel('Email', { exact: true }).waitFor({ state: 'visible' }); } finally { results.initialPage = await pageState(); }
    if (forbidden) throw new Error(forbidden);
    results.loginPageLoaded = true;
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'All Jobs', exact: true }).waitFor();
    results.login = 'PASS';
    stage = 'Job UI → Editor';
    let editor = await openEditor();
    stage = 'synthetic Job media delivery';
    const actualUrls = await editor.locator('.editor-media img').evaluateAll(nodes => nodes.map(n => n.src));
    assert.deepEqual([...new Set(actualUrls)].sort(), [...expectedMedia].sort(), 'JOB_MEDIA_LOADER_FIXTURE_URL_MISMATCH');
    results.media = [];
    for (const fixture of browserMedia) {
      const checked = await anonymousMediaGet(fixture.url);
      const row = { ...checked.evidence, expectedFixture: actualUrls.includes(fixture.url) };
      results.media.push(row);
      assert.equal(row.status, 200, 'MEDIA_HTTP_FAILED ' + row.pathname + ' status=' + row.status + ' code=' + row.errorCode);
      assert.equal(row.contentType?.split(';')[0], 'image/png', 'MEDIA_CONTENT_TYPE_FAILED ' + row.pathname);
      assert(row.png, 'MEDIA_PNG_SIGNATURE_FAILED ' + row.pathname);
      assert.equal(createHash('sha256').update(checked.bytes).digest('hex'), fixture.sha256, 'MEDIA_BYTES_MISMATCH');
      await sharp(checked.bytes).raw().toBuffer();
      row.pngBytes = 'PASS';
      // Decode the actual DOM image selected by its unchanged Job-loader src.
      row.browserDecode = await editor.locator('.editor-media img').evaluateAll(async (nodes, url) => {
        const node = nodes.find(n => n.src === url); if (!node) return false;
        try { await node.decode(); return node.naturalWidth > 0 && node.naturalHeight > 0; } catch { return false; }
      }, fixture.url);
      assert(row.browserDecode, 'MEDIA_BROWSER_DECODE_FAILED ' + row.pathname);
    }
    await editor.getByText('Media and font ready', { exact: false }).waitFor();
    results.mediaFontReady = 'PASS';
    stage = 'edit synthetic brief/scenes';
    await editor.getByLabel('Problem found *', { exact: true }).fill('Synthetic inspection found a loose fitting.');
    await editor.getByLabel('Work actually done *', { exact: true }).fill('Synthetic fitting was secured.');
    const sceneButtons = editor.getByRole('button', { name: /^Scene \d/ });
    assert.equal(await sceneButtons.count(), 3, 'Expected three synthetic scenes');
    await sceneButtons.nth(1).click();
    await editor.getByLabel('Confirmed fact source', { exact: true }).selectOption('work');
    await editor.getByLabel('headline', { exact: true }).fill('Synthetic fitting was secured.');
    await editor.getByLabel('Motion', { exact: true }).selectOption('none');
    await editor.getByLabel('Focal X', { exact: true }).fill('0.62');
    await editor.getByLabel('Duration (seconds)', { exact: true }).fill('3');
    await editor.getByRole('button', { name: 'Move earlier', exact: true }).click();
    // No unconfirmed text on other scenes; claims must remain grounded on approval.
    for (let i = 1; i < 3; i++) { await sceneButtons.nth(i).click(); await editor.getByLabel('Confirmed fact source', { exact: true }).selectOption('work'); await editor.getByLabel('headline', { exact: true }).fill('Synthetic fitting was secured.'); }
    await sceneButtons.nth(0).click();
    await editor.getByText('Company branding & separate Facebook caption', { exact: true }).click();
    await editor.getByRole('checkbox', { name: /^Company end card:/ }).uncheck();
    await editor.getByRole('checkbox', { name: /^I confirm these facts/ }).check();
    assert(await editor.locator('.editor-canvas').textContent().then(t => t.includes('Synthetic fitting was secured.')), 'Preview text not updated');
    await page.screenshot({ path: join(evidence, '01-editor.png'), fullPage: false });
    stage = 'Save';
    const saved = await clickOperation(editor.getByRole('button', { name: 'Save draft', exact: true }), 'save');
    assert.equal(saved.revision, 1); assert.equal(saved.brief_confirmation.actorId, managerId); assert.equal(saved.draft.brand.enabled, false);
    results.saveRevision = saved.revision;
    stage = 'first real page reload';
    await page.reload(); editor = await openEditor();
    await editor.getByText('Saved version 1', { exact: false }).waitFor();
    const reloaded = responses.filter(r => r.operation === 'load' && r.body.row).at(-1)?.body.row;
    assert.deepEqual(reloaded.draft, saved.draft); assert.deepEqual(reloaded.brief_confirmation, saved.brief_confirmation);
    assert.equal(await editor.getByLabel('Motion', { exact: true }).inputValue(), 'none');
    assert.equal(await editor.getByLabel('Focal X', { exact: true }).inputValue(), '0.62');
    assert.equal(await editor.getByLabel('Duration (seconds)', { exact: true }).inputValue(), '3');
    results.saveReload = 'PASS';
    stage = 'one snapshot approval';
    const approved = await clickOperation(editor.getByRole('button', { name: 'Approve this version', exact: true }), 'approve');
    assert(approved.approval?.creativePlanId);
    stage = 'second real page reload';
    await page.reload(); editor = await openEditor();
    await editor.getByText('Approved exact version', { exact: false }).waitFor();
    const afterApproval = responses.filter(r => r.operation === 'load' && r.body.row).at(-1)?.body.row;
    assert.deepEqual(afterApproval.approval, approved.approval); assert.equal(afterApproval.approvalApplicable, true);
    results.approvalReload = 'PASS';
    await page.screenshot({ path: join(evidence, '02-approved-reload.png'), fullPage: false });
    stage = 'caption-only save';
    await editor.getByText('Company branding & separate Facebook caption', { exact: true }).click();
    await editor.getByLabel('Facebook caption (does not change MP4)', { exact: true }).fill('Synthetic equipment details and work in progress.');
    const caption = await clickOperation(editor.getByRole('button', { name: 'Save draft', exact: true }), 'save');
    assert.equal(caption.approval.creativePlanId, approved.approval.creativePlanId); assert.equal(caption.approval.revision, approved.approval.revision);
    await editor.getByText('Approved exact version', { exact: false }).waitFor(); results.captionOnly = 'PASS';
    stage = 'video change invalidates approval';
    await editor.getByLabel('Duration (seconds)', { exact: true }).fill('5');
    const changed = await clickOperation(editor.getByRole('button', { name: 'Save draft', exact: true }), 'save');
    assert.equal(changed.approval, null);
    await editor.getByText('Approval required', { exact: false }).waitFor();
    assert.equal(await editor.getByRole('button', { name: 'Create MP4', exact: true }).isEnabled(), false);
    results.videoChange = 'PASS';
    await page.screenshot({ path: join(evidence, '03-approval-required.png'), fullPage: false });
    assert.equal(responses.filter(r => r.operation === 'approve').length, 1);
    })()]);
    if (forbidden) throw new Error(forbidden);
    assert.equal(counts.blockedAttempts, 0);
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'PASS', results, counts, diagnostics, pageReloads: 2, boundary: 'ordinary browser Job/Editor on ephemeral CI Auth/PostgREST; not Production E2E' }, null, 2));
    console.log(`PASS ordinary browser Job → Editor → Auth/PostgREST → Save/reload → Approval; caption-only/video-change PASS; counts=${JSON.stringify(counts)}`);
  } catch (error) {
    const condition = safe(forbidden || error.message);
    if (page) {
      try {
        results.failurePage = await pageState();
        if (stage === 'normal login' && !results.loginPageLoaded) results.loginFailureCategory = diagnostics.some(d => d.event === 'pageerror' || d.event === 'load-http-error') ? 'page/import error' : !results.failurePage.rootHasContent ? 'empty application' : results.failurePage.loginLabels.length ? 'accessible login labels differ or Email absent' : 'other UI';
        await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: false, mask: [page.locator('input, textarea, [contenteditable="true"]')] });
        results.failureScreenshot = 'failure.png';
      } catch (captureError) { results.captureError = safe(captureError.message); }
    }
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', stage, condition, results, counts, diagnostics }, null, 2));
    throw new Error(`BROWSER_FLOW_FAILED at ${stage}: ${condition.slice(0, 1200)}`);
  } finally { if (browser) await browser.close(); if (vite) await vite.close(); }
}
