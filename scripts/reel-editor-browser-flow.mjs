// One ordinary-application browser scenario; no session/RPC mocks or file adapter.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

export async function browserEditorFlow({ endpoint, anon, email, password, managerId, apiOrigin }) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const evidence = resolve(process.env.REEL_BROWSER_EVIDENCE);
  assert(!relative(resolve(process.env.RUNNER_TEMP), evidence).startsWith('..'));
  await mkdir(evidence, { recursive: true });
  process.env.VITE_SUPABASE_URL = endpoint;
  process.env.VITE_SUPABASE_ANON_KEY = anon;
  const vite = await createServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy: { '/api': apiOrigin } } });
  let browser;
  const counts = { render: 0, publication: 0, ai: 0, blockedExternal: 0 };
  const results = {};
  let stage = 'launch';
  try {
    await vite.listen();
    const { chromium } = await import(pathToFileURL(process.env.REEL_BROWSER_MODULE).href);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'ws:'].includes(url.protocol)) { counts.blockedExternal++; await route.abort(); return; }
      const path = url.pathname;
      if (/reel-render-request|begin_company_reel_render_request/.test(path)) counts.render++;
      if (/meta-social-publish|reconcile.*publication|publication.*reconcile/.test(path)) counts.publication++;
      if (/ai-content-generate|ai-media-analy|ai-reel-director|media-plan/.test(path)) counts.ai++;
      if (counts.render || counts.publication || counts.ai) { await route.abort(); return; }
      await route.continue();
    });
    const page = await context.newPage();
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
    stage = 'normal login';
    await page.goto('http://127.0.0.1:5189/');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'All Jobs', exact: true }).waitFor();
    stage = 'Job UI → Editor';
    let editor = await openEditor();
    await editor.getByText('Media and font ready', { exact: false }).waitFor();
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
    assert.equal(counts.render + counts.publication + counts.ai, 0);
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'PASS', results, counts, pageReloads: 2, boundary: 'ordinary browser Job/Editor on ephemeral CI Auth/PostgREST; not Production E2E' }, null, 2));
    console.log(`PASS ordinary browser Job → Editor → Auth/PostgREST → Save/reload → Approval; caption-only/video-change PASS; counts=${JSON.stringify(counts)}`);
  } catch (error) {
    // Only stage and safe condition; never raw browser/network/session dumps.
    const condition = String(error.message).replaceAll(password, '[redacted]').replaceAll(anon, '[redacted]').replace(/eyJ[\w.-]+/g, '[redacted]').slice(0, 1500);
    await writeFile(join(evidence, 'result.json'), JSON.stringify({ status: 'FAIL', stage, condition, results, counts }, null, 2));
    throw new Error(`BROWSER_FLOW_FAILED at ${stage}: ${condition.slice(0, 1200)}`);
  } finally { if (browser) await browser.close(); await vite.close(); }
}
