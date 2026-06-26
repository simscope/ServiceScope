const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'src/App.tsx');
const responsivePath = path.join(root, 'src/styles/responsive.css');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.writeFileSync(file, text);
}

function insertBeforeApp(app) {
  if (app.includes('function pageFromHash(hash: string): AppPage | null')) return app;

  const helpers = [
    '',
    'const ownerPageTitles: Record<AppPage, string> = {',
    "  dashboard: 'ServiceScope',",
    "  companies: 'Companies',",
    "  monitoring: 'Monitoring',",
    "  billing: 'Plans & Billing',",
    "  access: 'Access',",
    "  audit: 'Audit Log',",
    "  support: 'Support Inbox',",
    "  companyLogin: 'Company Login',",
    "  portal: 'Company Portal',",
    '};',
    '',
    'function pageFromHash(hash: string): AppPage | null {',
    "  const normalizedHash = hash.replace(/^#/, '').trim().toLowerCase();",
    '  switch (normalizedHash) {',
    "    case 'dashboard': return 'dashboard';",
    "    case 'companies': return 'companies';",
    "    case 'monitoring': return 'monitoring';",
    "    case 'billing': return 'billing';",
    "    case 'access': return 'access';",
    "    case 'audit': return 'audit';",
    "    case 'support': return 'support';",
    "    case 'company-login': return 'companyLogin';",
    "    case 'portal': return 'portal';",
    "    case 'login': return null;",
    "    default: return 'dashboard';",
    '  }',
    '}',
    '',
    'function hashForPage(page: AppPage) {',
    "  return page === 'companyLogin' ? '#company-login' : '#' + page;",
    '}',
    '',
    'function titleForPage(page: AppPage) {',
    "  return ownerPageTitles[page] ?? 'ServiceScope';",
    '}',
    '',
  ].join('\n');

  return app.replace('\nexport function App() {', helpers + '\nexport function App() {');
}

function patchApp() {
  let app = read(appPath);
  app = insertBeforeApp(app);

  app = app.replace(
    /  const initialPage =[\s\S]*?        : 'dashboard';/,
    "  const initialPage = pageFromHash(window.location.hash) ?? 'dashboard';",
  );

  app = app.replace(
    "  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readAuthSession());",
    "  const [authSession, setAuthSession] = useState<AuthSession | null>(() => (window.location.hash === '#login' ? null : readAuthSession()));",
  );

  if (!app.includes('function syncPageFromHash()')) {
    app = app.replace(
      "  useEffect(() => {\n    clearLegacyLocalBusinessData();\n  }, []);\n",
      [
        "  useEffect(() => {",
        "    clearLegacyLocalBusinessData();",
        "  }, []);",
        "",
        "  useEffect(() => {",
        "    function syncPageFromHash() {",
        "      if (window.location.hash === '#login') {",
        "        setAuthSession(null);",
        "        setSupabaseAccessToken(null);",
        "        window.localStorage.removeItem(AUTH_STORAGE_KEY);",
        "        return;",
        "      }",
        "",
        "      const nextPage = pageFromHash(window.location.hash);",
        "      if (nextPage) setPage(nextPage);",
        "    }",
        "",
        "    window.addEventListener('hashchange', syncPageFromHash);",
        "    return () => window.removeEventListener('hashchange', syncPageFromHash);",
        "  }, []);",
        "",
        "  useEffect(() => {",
        "    document.title = authSession ? titleForPage(page) + ' | ServiceScope' : 'Sign in | ServiceScope';",
        "    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });",
        "  }, [authSession, page]);",
      ].join('\n') + '\n',
    );
  }

  app = app.replace(
    /  function navigate\(nextPage: AppPage\) \{[\s\S]*?  \}\n\n  function recordAudit/,
    [
      "  function navigate(nextPage: AppPage) {",
      "    setPage(nextPage);",
      "    window.history.replaceState(null, '', hashForPage(nextPage));",
      "    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });",
      "  }",
      "",
      "  function recordAudit",
    ].join('\n'),
  );

  app = app.replace(
    "<h1>{page === 'support' ? 'Support Inbox' : page === 'companies' ? 'Companies' : page === 'monitoring' ? 'Monitoring' : page === 'billing' ? 'Plans & Billing' : page === 'access' ? 'Access' : page === 'audit' ? 'Audit Log' : 'ServiceScope'}</h1>",
    '<h1>{titleForPage(page)}</h1>',
  );

  app = app.replace(
    '<button className="icon-button" type="button" aria-label="Platform settings" title="Platform settings">',
    '<button className="icon-button" type="button" onClick={() => navigate(\'access\')} aria-label="Open platform settings" title="Open platform settings">',
  );

  const navLabels = [
    ['dashboard', 'Dashboard'],
    ['companies', 'Companies'],
    ['monitoring', 'Monitoring'],
    ['billing', 'Billing'],
    ['access', 'Access'],
    ['audit', 'Audit'],
    ['support', 'Support'],
  ];

  for (const [pageKey, label] of navLabels) {
    const from = "type=\"button\" onClick={() => navigate('" + pageKey + "')}>";
    const to = "type=\"button\" onClick={() => navigate('" + pageKey + "')} aria-label=\"" + label + "\" title=\"" + label + "\">";
    app = app.replace(from, to);
  }

  write(appPath, app);
}

function patchResponsive() {
  let css = read(responsivePath);
  if (css.includes('Owner shell responsive fixes')) return;

  css += [
    '',
    '/* Owner shell responsive fixes */',
    '@media (max-width: 1120px) {',
    '  .content-grid {',
    '    grid-template-columns: minmax(0, 1fr);',
    '  }',
    '',
    '  .detail-panel,',
    '  .add-panel {',
    '    position: static !important;',
    '    grid-column: auto;',
    '  }',
    '}',
    '',
    '@media (max-width: 820px) {',
    '  .nav-list {',
    '    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));',
    '  }',
    '',
    '  .nav-item {',
    '    justify-content: flex-start;',
    '    min-width: 0;',
    '    text-align: left;',
    '  }',
    '}',
    '',
  ].join('\n');

  write(responsivePath, css);
}

patchApp();
patchResponsive();
console.log('Owner routing and responsive UX patch applied.');
