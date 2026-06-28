const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storePath = path.join(root, 'src/services/supportStore.ts');
const appPath = path.join(root, 'src/App.tsx');

let store = fs.readFileSync(storePath, 'utf8');

if (!store.includes('function clearStoredSupportTickets')) {
  store = store.replace(
    /function formatSupportTime\(value\?: string \| null\) \{[\s\S]*?\n\}/,
    (match) => `${match}\n\nfunction clearStoredSupportTickets() {\n  if (typeof window === 'undefined') return;\n  window.localStorage.removeItem(SUPPORT_STORAGE_KEY);\n}`,
  );
}

store = store.replace(
  /export function listSupportTickets\(companies: Company\[\]\): SupportTicket\[\] \{[\s\S]*?\n\}/,
  `export function listSupportTickets(companies: Company[]): SupportTicket[] {
  if (isSupabaseConfigured()) {
    clearStoredSupportTickets();
    return [];
  }

  return readStoredTickets().map((ticket) => normalizeTicket(ticket, companies));
}`,
);

store = store.replace(
  /  const mapped = tickets\.map\(\(ticket\) => rowToTicket\(ticket, messages, companies\)\);\n  if \(typeof window !== 'undefined'\) \{\n    window\.localStorage\.setItem\(SUPPORT_STORAGE_KEY, JSON\.stringify\(mapped\)\);\n  \}\n  return mapped;/,
  `  clearStoredSupportTickets();
  return tickets.map((ticket) => rowToTicket(ticket, messages, companies));`,
);

store = store.replace(
  /export function saveSupportTickets\(tickets: SupportTicket\[\]\) \{[\s\S]*?\n\}\n\nexport function createSupportTicket/,
  `export function saveSupportTickets(tickets: SupportTicket[]) {
  if (isSupabaseConfigured()) {
    clearStoredSupportTickets();
  } else if (typeof window !== 'undefined') {
    window.localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(tickets));
  }

  void persistSupportTicketsToBackend(tickets).catch((error) => {
    console.error('Failed to save support tickets to Supabase', error);
  });
}

export function createSupportTicket`,
);

fs.writeFileSync(storePath, store);

let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(
  /  useEffect\(\(\) => \{\n    function syncSupportTicketsFromStorage\(\) \{[\s\S]*?\n  \}, \[companies\]\);\n\n/,
  '',
);
fs.writeFileSync(appPath, app);

console.log('Support DB-only source patch applied.');
