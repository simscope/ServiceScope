const path = require('path');

const patches = [
  'patch-job-material-save.cjs',
  'patch-owner-routing-ux-v2.cjs',
  'patch-login-qa-fixes.cjs',
  'patch-billing-company-cards.cjs',
  'cleanup-billing-cards.cjs',
  'patch-billing-company-window-labels.cjs',
  'patch-companies-phone-modal.cjs',
  'patch-finance-payroll-compact.cjs',
  'patch-finance-calculation-fixes.cjs',
  'patch-payroll-backend-tables.cjs',
  'patch-materials-open-job-card.cjs',
  'patch-job-attachment-upload-compress.cjs',
  'patch-job-attachment-preview.cjs',
  'patch-job-attachment-download-selection-v2.cjs',
  'patch-job-attachment-delete-sync.cjs',
  'patch-email-new-email-blank.cjs',
  'patch-email-attachments-storage.cjs',
  'patch-library-storage.cjs',
  'patch-portal-dashboard-ux.cjs',
  'patch-owner-support-inbox-ux.cjs',
  'patch-support-company-workspaces.cjs',
  'patch-support-supabase-store.cjs',
  'patch-remove-provisioning-safe.cjs',
  'patch-owner-dashboard-command-center.cjs',
];

for (const patch of patches) {
  require(path.join(__dirname, patch));
}

console.log('All safe ServiceScope patches applied.');
