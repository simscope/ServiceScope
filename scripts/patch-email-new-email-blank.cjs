const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/components/portal/EmailPage.tsx');
let content = fs.readFileSync(filePath, 'utf8');

if (!content.includes('const makeBlankEmailCompose = ()')) {
  content = content.replace(
    `  const openCompose = (nextCompose?: EmailCompose) => {
    if (nextCompose) {
      onEmailComposeChange({
        ...nextCompose,
        signatureText: companySignature,
        paymentBlockText: companyPaymentBlock,
      });
    } else {
      onEmailComposeChange({
        ...emailCompose,
        signatureText: companySignature,
        paymentBlockText: companyPaymentBlock,
      });
    }
    setComposeOpen(true);
  };`,
    `  const makeBlankEmailCompose = (): EmailCompose => ({
    to: '',
    subject: '',
    body: '',
    jobNumber: '',
    includeSignature: true,
    includePaymentBlock: false,
    signatureText: companySignature,
    paymentBlockText: companyPaymentBlock,
  });

  const openCompose = (nextCompose?: EmailCompose, keepCurrentDraft = false) => {
    const compose = nextCompose ?? (keepCurrentDraft ? emailCompose : makeBlankEmailCompose());
    onEmailComposeChange({
      ...compose,
      signatureText: compose.signatureText || companySignature,
      paymentBlockText: compose.paymentBlockText || companyPaymentBlock,
    });
    setComposeOpen(true);
  };`,
  );
}

content = content.replace('    openCompose();\n  }, [composeRequestId]);', '    openCompose(undefined, true);\n  }, [composeRequestId]);');

fs.writeFileSync(filePath, content);
console.log('Email new email blank composer patch applied.');
