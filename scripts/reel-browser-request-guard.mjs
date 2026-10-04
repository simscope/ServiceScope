import assert from 'node:assert/strict';

const safeActions = new Set(['status', 'load', 'save', 'approve', 'publish_facebook_reel', 'reconcile_facebook_reel', 'publish_facebook_text', 'publish_facebook_single_photo']);
export function classifyBrowserRequest({ url, method, resourceType, action }, { appOrigin, backendOrigin }) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  const safeAction = safeActions.has(action) ? action : undefined;
  const base = { origin: parsed.origin, pathname: path, method, resourceType, ...(safeAction ? { action: safeAction } : {}) };
  const decide = (decision, rule, operation) => ({ ...base, decision, rule, ...(operation ? { operation } : {}) });
  if (![appOrigin, backendOrigin].includes(parsed.origin)) return decide('block', 'outside-test-origins', 'external');
  // API classification precedes resource classification: a script suffix cannot bypass it.
  if (path === '/api/reel-render-request') return decide('block', 'render-request', 'render');
  if (path.startsWith('/functions/v1/')) {
    if (['/functions/v1/ai-content-generate', '/functions/v1/ai-media-analyze'].includes(path)) return decide('block', 'generation-function', 'ai');
    if (['/functions/v1/meta-social-publish', '/functions/v1/meta-social-connection'].includes(path)) {
      // Both status branches use repository snapshots, never Meta (service.js).
      if (parsed.origin === backendOrigin && method === 'POST' && action === 'status') return decide('allow', 'local-no-meta-status');
      return decide('block', 'provider-action-or-unknown', 'publication');
    }
    return decide('block', 'unknown-function', 'unknown');
  }
  if (path.startsWith('/api/')) {
    if (parsed.origin === appOrigin && path === '/api/reel-editor' && method === 'POST' && ['load', 'save', 'approve'].includes(action)) return decide('allow', 'local-editor');
    return decide('block', 'unknown-api', 'unknown');
  }
  if (path.startsWith('/rest/v1/rpc/')) {
    const rpc = path.slice('/rest/v1/rpc/'.length);
    if (['begin_company_reel_render_request', 'claim_company_reel_render_job', 'release_company_reel_render_job_for_retry', 'complete_company_reel_render_job', 'fail_company_reel_render_job', 'prepare_company_reel_render_retry', 'begin_company_reel_render_retry'].includes(rpc)) return decide('block', 'mutating-render-rpc', 'render');
    if (parsed.origin === backendOrigin && method === 'POST' && ['get_company_reel_workspace', 'get_company_reel_media_selector', 'app_current_session'].includes(rpc)) return decide('allow', 'local-read-rpc');
    return decide('block', 'unknown-rpc', 'unknown');
  }
  if (parsed.origin === backendOrigin) {
    if (path.startsWith('/auth/v1/') && ['GET', 'POST'].includes(method)) return decide('allow', 'local-auth');
    if (path.startsWith('/rest/v1/') && ['GET', 'HEAD'].includes(method)) return decide('allow', 'local-postgrest-read');
    if (path.startsWith('/storage/v1/object/') && ['GET', 'HEAD', 'POST'].includes(method)) return decide('allow', 'local-synthetic-media');
    return decide('block', 'unknown-backend', 'unknown');
  }
  if (method === 'GET' && ['document', 'script', 'stylesheet', 'font', 'image', 'other'].includes(resourceType)) return decide('allow', resourceType === 'script' ? 'frontend-module' : 'frontend-resource');
  return decide('block', 'unknown-app-request', 'unknown');
}

export function classifierRegression() {
  const origins = { appOrigin: 'http://127.0.0.1:5189', backendOrigin: 'http://127.0.0.1:54321' };
  const check = (path, expected, extra = {}, origin = origins.appOrigin) => assert.equal(classifyBrowserRequest({ url: origin + path, method: 'GET', resourceType: 'script', ...extra }, origins).decision, expected, path);
  check('/src/features/media-planning/planningState.ts', 'allow');
  for (const [path, resourceType] of [['/ai-assistant.css', 'stylesheet'], ['/media-plan.woff2', 'font'], ['/ai-media-analyze.png', 'image']]) check(path, 'allow', { resourceType });
  for (const path of ['/functions/v1/ai-content-generate', '/functions/v1/ai-media-analyze']) check(path, 'block', { method: 'POST' }, origins.backendOrigin);
  check('/api/reel-render-request', 'block', { method: 'POST' });
  for (const action of ['publish_facebook_reel', 'reconcile_facebook_reel', 'unknown']) check('/functions/v1/meta-social-publish', 'block', { method: 'POST', action }, origins.backendOrigin);
  check('/functions/v1/meta-social-publish', 'allow', { method: 'POST', action: 'status' }, origins.backendOrigin);
  check('/api/unknown.js', 'block');
  check('/rest/v1/rpc/begin_company_reel_render_request', 'block', { method: 'POST' }, origins.backendOrigin);
  check('/index.js', 'block', {}, 'https://servicescope-inky.vercel.app');
  check('/index.js', 'block', {}, 'http://127.0.0.1:9999');
  check('/src/features/media-planning/planningState.ts', 'allow');
  console.log('PASS browser request classifier regression (no network)');
}
