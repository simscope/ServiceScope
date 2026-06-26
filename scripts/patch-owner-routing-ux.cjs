const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function read(relativePath) {
  return fs.readFileSync(filePath(relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(filePath(relativePath), content);
}

function replaceOnce(relativePath, before, after, marker) {
  let content = read(relativePath);
  if (content.includes(marker)) return;
  if (!content.includes(before)) return;
  content = content.replace(before, after);
  write(relativePath, content);
}

function replaceAll(relativePath, before, after) {
  let content = read(relativePath);
  if (!content.includes(before)) return;
  content = content.split(before).join(after);
  write(relativePath, content);
}

const appHelpers = `
const ownerPageTitles: Record<AppPage, string> = {
  dashboard: 'ServiceScope',
  companies: 'Companies',
  monitoring: 'Monitoring',
  billing: 'Plans & Billing',
  access: 'Access',
  audit: 'Audit Log',
  support: 'Support Inbox',
  companyLogin: 'Company Login',
  portal: 'Company Portal',
};

function pageFromHash(hash: string): AppPage | null {
  const normalizedHash = hash.replace(/^#/, '').trim().toLowerCase();

  switch (normalizedHash) {
    case 'dashboard':
      return 'dashboard';
    case 'companies':
      return 'companies';
    case 'monitoring':
      return 'monitoring';
    case 'billing':
      return 'billing';
    case 'access':
      return 'access';
    case 'audit':
      return 'audit';
    case 'support':
      return 'support';
    case 'company-login':
      return 'companyLogin';
    case 'portal':
      return 'portal';
    case 'login':
      return null;
    default:
      return 'dashboard';
  }
}

function hashForPage(page: AppPage) {
  return page === 'companyLogin' ? '#company-login' : `#${page}`;
}

function titleForPage(page: AppPage) {
  return ownerPageTitles[page] ?? 'ServiceScope';
}
`;

replaceOnce(
  'src/App.tsx',
  '\nexport function App() {',
  `${appHelpers}\nexport function App() {`,
  'function pageFromHash(hash: string): AppPage | null',
);

replaceOnce(
  'src/App.tsx',
  `  const initialPage =
    window.location.hash === '#support'
      ? 'support'
      : window.location.hash === '#company-login'
        ? 'companyLogin'
      : window.location.hash === '#portal'
        ? 'portal'
      : window.location.hash === '#companies'
        ? 'companies'
        : window.location.hash === '#monitoring'
          ? 'monitoring'
        : window.location.hash === '#billing'
          ? 'billing'
          : window.location.hash === '#access'
            ? 'access'
            : window.location.hash === '#audit'
              ? 'audit'
        : 'dashboard';`,
  `  const initialPage = pageFromHash(window.location.hash) ?? 'dashboard';`,
  'const initialPage = pageFromHash(window.location.hash)',
);

replaceOnce(
  'src/App.tsx',
  `  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readAuthSession());`,
  `  const [authSession, setAuthSession] = useState<AuthSession | null>(() => (window.location.hash === '#login' ? null : readAuthSession()));`,
  "window.location.hash === '#login' ? null : readAuthSession()",
);

replaceOnce(
  'src/App.tsx',
  `  useEffect(() => {
    clearLegacyLocalBusinessData();
  }, []);
`,
  `  useEffect(() => {
    clearLegacyLocalBusinessData();
  }, []);

  useEffect(() => {
    function syncPageFromHash() {
      if (window.location.hash === '#login') {
        setAuthSession(null);
        setSupabaseAccessToken(null);
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }

      const nextPage = pageFromHash(window.location.hash);
      if (nextPage) {
        setPage(nextPage);
      }
    }

    window.addEventListener('hashchange', syncPageFromHash);
    return () => window.removeEventListener('hashchange', syncPageFromHash);
  }, []);

  useEffect(() => {
    document.title = authSession ? `${titleForPage(page)} | ServiceScope` : 'Sign in | ServiceScope';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [authSession, page]);
`,
  'function syncPageFromHash()',
);

replaceOnce(
  'src/App.tsx',
  `  function navigate(nextPage: AppPage) {
    setPage(nextPage);
    window.history.replaceState(null, '', ` + '`#${nextPage === \'companyLogin\' ? \'company-login\' : nextPage}`' + `);
  }
`,
  `  function navigate(nextPage: AppPage) {
    setPage(nextPage);
    window.history.replaceState(null, '', hashForPage(nextPage));
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
`,
  'hashForPage(nextPage)',
);

replaceOnce(
  'src/App.tsx',
  `<h1>{page === 'support' ? 'Support Inbox' : page === 'companies' ? 'Companies' : page === 'monitoring' ? 'Monitoring' : page === 'billing' ? 'Plans & Billing' : page === 'access' ? 'Access' : page === 'audit' ? 'Audit Log' : 'ServiceScope'}</h1>`,
  `<h1>{titleForPage(page)}</h1>`,
  '<h1>{titleForPage(page)}</h1>',
);

replaceOnce(
  'src/App.tsx',
  `<button className="icon-button" type="button" aria-label="Platform settings" title="Platform settings">
            <SlidersHorizontal size={20} aria-hidden="true" />
          </button>`,
  `<button className="icon-button" type="button" onClick={() => navigate('access')} aria-label="Open platform settings" title="Open platform settings">
            <SlidersHorizontal size={20} aria-hidden="true" />
          </button>`,
  "onClick={() => navigate('access')} aria-label=\"Open platform settings\"",
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

for (const [page, label] of navLabels) {
  replaceOnce(
    'src/App.tsx',
    `<button className={\`nav-item \${page === '${page}' ? 'active' : ''}\`} type="button" onClick={() => navigate('${page}')}>`,
    `<button className={\`nav-item \${page === '${page}' ? 'active' : ''}\`} type="button" onClick={() => navigate('${page}' as AppPage)} aria-label="${label}" title="${label}">`,
    `aria-label="${label}" title="${label}"`,
  );
}

const responsiveFixCss = `

/* Owner shell responsive fixes */
@media (max-width: 1120px) {
  .content-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail-panel,
  .add-panel {
    position: static !important;
    grid-column: auto;
  }
}

@media (max-width: 820px) {
  .nav-list {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .nav-item {
    justify-content: flex-start;
    min-width: 0;
    text-align: left;
  }
}
`;

const responsivePath = 'src/styles/responsive.css';
const responsiveContent = read(responsivePath);
if (!responsiveContent.includes('Owner shell responsive fixes')) {
  write(responsivePath, `${responsiveContent}${responsiveFixCss}`);
}

console.log('Owner routing, title, scroll, settings button, and responsive UX patches applied.');
