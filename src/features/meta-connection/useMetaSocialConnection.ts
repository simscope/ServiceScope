import { useCallback, useEffect, useState } from 'react';
import {
  checkMetaConnection,
  disconnectMetaConnection,
  loadMetaConnectionStatus,
  selectMetaAsset,
  startMetaConnection,
} from './clientApi';
import type { MetaAuthorizationIntent, MetaConnectionSnapshot } from './contracts';

export function useMetaSocialConnection(companyId: string) {
  const [snapshot, setSnapshot] = useState<MetaConnectionSnapshot | null>(null);
  const [busy, setBusy] = useState<'loading' | 'starting' | 'selecting' | 'checking' | 'disconnecting' | ''>('loading');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setBusy('loading');
    setMessage('');
    try {
      setSnapshot(await loadMetaConnectionStatus(companyId));
    } catch (error) {
      setMessage(normalizeError(error));
    } finally {
      setBusy('');
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  async function start(authorizationIntent?: MetaAuthorizationIntent) {
    setBusy('starting');
    setMessage('');
    try {
      const result = await startMetaConnection(companyId, authorizationIntent);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setBusy('');
      setMessage(normalizeError(error));
    }
  }

  async function select(oauthSessionId: string, pageId: string) {
    setBusy('selecting');
    setMessage('');
    try {
      await selectMetaAsset(companyId, oauthSessionId, pageId);
      await load();
      setMessage('Meta Page connected.');
    } catch (error) {
      setBusy('');
      setMessage(normalizeError(error));
    }
  }

  async function check() {
    if (!snapshot?.connection) return;
    setBusy('checking');
    setMessage('');
    try {
      const result = await checkMetaConnection(companyId, snapshot.connection.id);
      setSnapshot((current) => current ? { ...current, connection: result.connection } : current);
      setMessage(result.ok ? 'Connection check passed.' : 'Meta authorization needs attention.');
    } catch (error) {
      setMessage(normalizeError(error));
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    if (!snapshot?.connection) return;
    setBusy('disconnecting');
    setMessage('');
    try {
      await disconnectMetaConnection(companyId, snapshot.connection.id);
      await load();
      setMessage('Meta connection disconnected.');
    } catch (error) {
      setBusy('');
      setMessage(normalizeError(error));
    }
  }

  return { busy, check, disconnect, load, message, select, snapshot, start };
}

function normalizeError(error: unknown) {
  const value = error instanceof Error ? error.message : '';
  if (/META_NOT_CONFIGURED/.test(value)) return 'Meta integration is not configured for this environment.';
  if (/FORBIDDEN|401|403/.test(value)) return 'You are not authorized to manage Social connections.';
  if (/OAUTH_STATE_EXPIRED|OAUTH_STATE_REPLAYED/.test(value)) return 'This authorization is expired or was already used. Start a new connection.';
  if (/META_RATE_LIMITED/.test(value)) return 'Meta is temporarily limiting connection checks. Try again later.';
  return 'Meta connection could not be updated safely.';
}
