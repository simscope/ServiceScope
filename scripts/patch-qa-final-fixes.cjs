const fs = require('fs');
const path = require('path');

const portalFile = path.resolve(__dirname, '../src/CompanyPortal.tsx');
let content = fs.readFileSync(portalFile, 'utf8');

if (!content.includes('const [mailboxLoading, setMailboxLoading]')) {
  content = content.replace(
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);",
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);\n  const [mailboxLoading, setMailboxLoading] = useState(false);",
  );
}

if (!content.includes('mailboxLoading={mailboxLoading}')) {
  content = content.replace(
    '            mailboxConnectStatus={mailboxConnectStatus}',
    '            mailboxConnectStatus={mailboxConnectStatus}\n            mailboxLoading={mailboxLoading}',
  );
}

fs.writeFileSync(portalFile, content);
console.log('Final QA mailbox loading prop patch applied.');
