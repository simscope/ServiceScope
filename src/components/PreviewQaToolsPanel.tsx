import { useState } from 'react';
import { ServerCog } from 'lucide-react';
import { managePreviewQaWorkspace, type PreviewQaWorkspaceAction } from '../services/previewQaWorkspace';

export function PreviewQaToolsPanel() {
  const [email, setEmail] = useState('');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);

  async function runAction(action: PreviewQaWorkspaceAction) {
    if (action === 'create' || action === 'enable') {
      if (!email.trim()) {
        setStatus('QA email is required.');
        return;
      }
      if (temporaryPassword.trim().length < 12) {
        setStatus('Temporary password must be at least 12 characters.');
        return;
      }
    }

    setPending(true);
    setStatus(action === 'create'
      ? 'Creating QA workspace...'
      : action === 'disable'
        ? 'Disabling QA workspace...'
        : action === 'enable'
          ? 'Enabling QA workspace...'
          : 'Deleting QA workspace...');
    try {
      const result = await managePreviewQaWorkspace({
        action,
        email: action === 'create' || action === 'enable' ? email : undefined,
        temporaryPassword: action === 'create' || action === 'enable' ? temporaryPassword : undefined,
      });
      setStatus(
        action === 'create'
          ? `QA workspace ready for ${result.email}. Use the ordinary Preview login form.`
          : action === 'disable'
            ? 'QA workspace disabled.'
            : action === 'enable'
              ? `QA workspace enabled for ${result.email}. Use the ordinary Preview login form.`
              : `QA workspace deleted. Remaining rows: ${result.remainingRows}; storage objects: ${result.remainingStorageObjects}; auth users: ${result.remainingAuthUsers}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'QA workspace action failed.');
    } finally {
      setTemporaryPassword('');
      setPending(false);
    }
  }

  return (
    <section className="panel invite-panel access-qa-tools-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Admin / QA Tools</p>
          <h2>Preview QA workspace</h2>
        </div>
        <ServerCog size={20} aria-hidden="true" />
      </div>
      <p className="access-note">
        Creates an isolated AI_QA_ tenant and non-owner QA user through the server-side admin flow.
        Use a temporary password and delete the workspace after smoke testing.
      </p>
      <label>
        QA email
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="qa-user@example.com" />
      </label>
      <label>
        Temporary password
        <input
          type="password"
          value={temporaryPassword}
          onChange={(event) => setTemporaryPassword(event.target.value)}
          placeholder="Temporary password"
          autoComplete="new-password"
        />
      </label>
      <div className="access-qa-actions">
        <button className="primary-button compact" type="button" onClick={() => runAction('create')} disabled={pending}>
          Create QA workspace
        </button>
        <button className="secondary-button compact" type="button" onClick={() => runAction('disable')} disabled={pending}>
          Disable QA user
        </button>
        <button className="secondary-button compact" type="button" onClick={() => runAction('enable')} disabled={pending}>
          Enable QA user
        </button>
        <button className="secondary-button compact danger-button" type="button" onClick={() => runAction('delete')} disabled={pending}>
          Delete QA workspace
        </button>
      </div>
      {status ? <p className="access-status">{status}</p> : null}
    </section>
  );
}
