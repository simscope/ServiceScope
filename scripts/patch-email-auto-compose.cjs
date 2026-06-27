const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../src/components/portal/EmailPage.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  "import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';",
  "import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';",
);

if (!content.includes('autoOpenedComposeRef')) {
  content = content.replace(
    "  const [sending, setSending] = useState(false);",
    "  const [sending, setSending] = useState(false);\n  const autoOpenedComposeRef = useRef(false);",
  );
}

if (!content.includes('Open composer automatically when the Email tab is opened')) {
  content = content.replace(
    "  const closeCompose = () => {\n    clearComposeAttachments();\n    setComposeOpen(false);\n  };",
    "  const closeCompose = () => {\n    clearComposeAttachments();\n    setComposeOpen(false);\n  };\n\n  useEffect(() => {\n    if (autoOpenedComposeRef.current || emailConnection?.status !== 'connected') return;\n\n    autoOpenedComposeRef.current = true;\n    openCompose();\n  }, [emailConnection?.status]);\n  // Open composer automatically when the Email tab is opened.",
  );
}

fs.writeFileSync(file, content);
console.log('Email auto compose patch applied.');
