const fs = require('fs');
const path = require('path');

const portalFile = path.resolve(__dirname, '../src/CompanyPortal.tsx');
let portal = fs.readFileSync(portalFile, 'utf8');

if (!portal.includes('const [mailboxLoading, setMailboxLoading]')) {
  portal = portal.replace(
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);",
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);\n  const [mailboxLoading, setMailboxLoading] = useState(false);",
  );
}

// Remove any accidental placement on OnboardingPage or other components.
portal = portal.replace(/\n\s+mailboxLoading=\{mailboxLoading\}/g, '');

// Add it only to EmailPage, which has emailFolder immediately after mailboxConnectStatus.
portal = portal.replace(
  '            mailboxConnectStatus={mailboxConnectStatus}\n            emailFolder={emailFolder}',
  '            mailboxConnectStatus={mailboxConnectStatus}\n            mailboxLoading={mailboxLoading}\n            emailFolder={emailFolder}',
);

fs.writeFileSync(portalFile, portal);

const emailPageFile = path.resolve(__dirname, '../src/components/portal/EmailPage.tsx');
let emailPage = fs.readFileSync(emailPageFile, 'utf8');

emailPage = emailPage.replace(
  '  mailboxLoading: boolean;',
  '  mailboxLoading?: boolean;',
);

fs.writeFileSync(emailPageFile, emailPage);

console.log('Final QA mailbox loading prop patch applied.');
