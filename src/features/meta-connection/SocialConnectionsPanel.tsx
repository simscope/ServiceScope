import { CheckCircle2, Facebook, Instagram, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useState } from 'react';
import {
  META_FACEBOOK_PUBLISHING_SCOPE,
  META_REQUESTED_SCOPES,
  type MetaAuthorizationIntent,
  type MetaSafeConnection,
} from './contracts';
import { useMetaSocialConnection } from './useMetaSocialConnection';

export function SocialConnectionsPanel({ companyId }: { companyId: string }) {
  const connection = useMetaSocialConnection(companyId);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const snapshot = connection.snapshot;
  const busy = Boolean(connection.busy);

  return (
    <section className="panel social-connections-panel" aria-labelledby="social-connections-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Official integrations</p>
          <h2 id="social-connections-title">Social connections</h2>
        </div>
        <Link2 size={20} aria-hidden="true" />
      </div>

      <div className="social-provider-heading">
        <span className="social-provider-icon"><Facebook size={20} aria-hidden="true" /></span>
        <div>
          <strong>Meta — Facebook &amp; Instagram</strong>
          <p>Connect an authorized Facebook Page and its linked Instagram Professional account.</p>
        </div>
      </div>

      {connection.busy === 'loading' && !snapshot ? <p className="social-connection-status">Loading connection status...</p> : null}
      {snapshot && !snapshot.configured ? (
        <div className="social-connection-state warning-state">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>Not configured</strong>
            <p>Meta integration is not configured for this environment.</p>
          </div>
        </div>
      ) : null}

      {snapshot?.configured && snapshot.pending ? (
        <div className="social-connection-state">
          <div>
            <strong>Choose a Facebook Page</strong>
            <p>Select one Page from the assets returned by your Meta authorization.</p>
          </div>
          <div className="social-asset-list">
            {snapshot.pending.assets.map((asset) => (
              <div className="social-asset-row" key={asset.pageId}>
                <div>
                  <span><Facebook size={16} aria-hidden="true" /> {asset.pageName}</span>
                  {asset.instagram ? (
                    <small><Instagram size={15} aria-hidden="true" /> @{asset.instagram.username} · {asset.instagram.accountType === 'BUSINESS' ? 'Business' : 'Creator'}</small>
                  ) : <small>Facebook only · no linked Instagram Professional account</small>}
                </div>
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={busy}
                  onClick={() => connection.select(snapshot.pending!.oauthSessionId, asset.pageId)}
                >
                  Select
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {snapshot?.configured && !snapshot.pending && !snapshot.connection ? (
        <div className="social-connection-state">
          <div className="social-connection-copy">
            <strong>Not connected</strong>
            <p>A Facebook account with access to at least one Page is required. Instagram must be a linked Business or Creator account.</p>
            <p>Connection requests only Page discovery and basic Instagram account access. Publishing permissions are not requested.</p>
          </div>
          <ScopeList />
          <button className="primary-button" type="button" disabled={busy} onClick={() => connection.start()}>
            <Facebook size={16} aria-hidden="true" />
            {connection.busy === 'starting' ? 'Opening Meta...' : 'Connect Meta'}
          </button>
        </div>
      ) : null}

      {snapshot?.configured && snapshot.connection ? (
        <ConnectedState
          value={snapshot.connection}
          busy={busy}
          openingMeta={connection.busy === 'starting'}
          confirmDisconnect={confirmDisconnect}
          onCheck={connection.check}
          onReconnect={connection.start}
          onDisconnect={() => setConfirmDisconnect(true)}
          onCancelDisconnect={() => setConfirmDisconnect(false)}
          onConfirmDisconnect={async () => {
            await connection.disconnect();
            setConfirmDisconnect(false);
          }}
        />
      ) : null}

      {connection.message ? <p className="social-connection-status" role="status">{connection.message}</p> : null}
    </section>
  );
}

function ConnectedState({
  value,
  busy,
  openingMeta,
  confirmDisconnect,
  onCheck,
  onReconnect,
  onDisconnect,
  onCancelDisconnect,
  onConfirmDisconnect,
}: {
  value: MetaSafeConnection;
  busy: boolean;
  openingMeta: boolean;
  confirmDisconnect: boolean;
  onCheck: () => void;
  onReconnect: (authorizationIntent?: MetaAuthorizationIntent) => void;
  onDisconnect: () => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: () => void;
}) {
  const authorizationReconnectRequired = value.status === 'needs_reauthorization' || value.tokenExpiryStatus === 'expired';
  const missingPublishingPermission = !value.grantedScopes.includes(META_FACEBOOK_PUBLISHING_SCOPE);
  const publishingReconnectRequired = value.status !== 'revoked'
    && !authorizationReconnectRequired
    && missingPublishingPermission;
  return (
    <div className={`social-connection-state ${authorizationReconnectRequired ? 'warning-state' : 'connected-state'}`}>
      <div className="social-connected-summary">
        {authorizationReconnectRequired ? <ShieldCheck size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
        <div>
          <strong>{authorizationReconnectRequired ? 'Needs reauthorization' : 'Connected'}</strong>
          <p><Facebook size={15} aria-hidden="true" /> {value.facebookPageName}</p>
          {value.instagramUsername ? <p><Instagram size={15} aria-hidden="true" /> @{value.instagramUsername}</p> : <p>Facebook-only connection</p>}
        </div>
      </div>
      <dl className="social-connection-metadata">
        <div><dt>Provider</dt><dd>Meta Facebook Login</dd></div>
        <div><dt>Connected</dt><dd>{formatDate(value.connectedAt)}</dd></div>
        <div><dt>Last check</dt><dd>{formatDate(value.lastCheckedAt)}</dd></div>
        <div><dt>Authorization expiry</dt><dd>{value.tokenExpiryStatus}</dd></div>
      </dl>
      <ScopeList scopes={value.grantedScopes} />
      {publishingReconnectRequired ? (
        <p className="social-connection-status">
          Facebook publishing permission is not enabled. Reconnect Meta to add pages_manage_posts.
        </p>
      ) : null}
      <div className="social-connection-actions">
        {authorizationReconnectRequired || publishingReconnectRequired ? (
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => onReconnect(publishingReconnectRequired ? 'facebook_publishing' : undefined)}
          >
            <Facebook size={16} aria-hidden="true" /> {openingMeta ? 'Opening Meta...' : 'Reconnect Meta'}
          </button>
        ) : null}
        {!authorizationReconnectRequired ? (
          <button className="secondary-button" type="button" disabled={busy} onClick={onCheck}>
            <RefreshCw size={16} aria-hidden="true" /> Check connection
          </button>
        ) : null}
        <button className="secondary-button danger-button" type="button" disabled={busy} onClick={onDisconnect}>
          <Unplug size={16} aria-hidden="true" /> Disconnect Meta
        </button>
      </div>
      {confirmDisconnect ? (
        <div className="social-disconnect-confirmation" role="alertdialog" aria-label="Confirm Meta disconnect">
          <strong>Disconnect this Meta authorization?</strong>
          <p>Local authorization material will be destroyed and reconnecting will require a new Facebook Login flow.</p>
          <div>
            <button className="secondary-button" type="button" onClick={onCancelDisconnect}>Cancel</button>
            <button className="primary-button danger-button" type="button" onClick={onConfirmDisconnect}>Confirm disconnect</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ScopeList({ scopes = [...META_REQUESTED_SCOPES] }: { scopes?: readonly string[] }) {
  return (
    <div className="social-scope-list" aria-label="Meta permissions">
      {scopes.map((scope) => <span key={scope}>{scope}</span>)}
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Not checked';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}
