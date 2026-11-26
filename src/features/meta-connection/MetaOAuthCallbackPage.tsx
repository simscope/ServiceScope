import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { completeMetaConnection } from './clientApi';
import type { MetaOAuthCallbackPayload, MetaReturnDestination } from './contracts';

type CallbackState = 'idle' | 'completing' | 'complete' | 'expired' | 'no_pages' | 'error' | 'authentication_required';

export function MetaOAuthCallbackPage({
  callback,
  authenticated,
  allowedRole,
  onReturn,
}: {
  callback: MetaOAuthCallbackPayload;
  authenticated: boolean;
  allowedRole: boolean;
  onReturn: (destination: MetaReturnDestination, noPages: boolean) => void;
}) {
  const [state, setState] = useState<CallbackState>('idle');
  const [destination, setDestination] = useState<MetaReturnDestination>('social_connections');

  useEffect(() => {
    let active = true;
    if (!authenticated || !allowedRole) {
      setState('authentication_required');
      return () => { active = false; };
    }
    if ((!callback.code && !callback.providerError) || !callback.state) {
      setState('error');
      return () => { active = false; };
    }
    setState('completing');
    completeMetaConnection(callback)
      .then((result) => {
        if (!active) return;
        setDestination(result.destination);
        setState('complete');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof Error ? error.message.split(':', 1)[0] : '';
        if (code === 'OAUTH_STATE_EXPIRED') setState('expired');
        else if (code === 'META_NO_PAGES') setState('no_pages');
        else setState('error');
      });
    return () => { active = false; };
  }, [allowedRole, authenticated, callback]);

  const complete = state === 'complete';
  return (
    <main className="auth-shell meta-callback-shell">
      <section className="auth-card meta-callback-card" aria-live="polite">
        {complete ? <CheckCircle2 size={28} aria-hidden="true" /> : <ShieldAlert size={28} aria-hidden="true" />}
        <p className="eyebrow">Meta connection</p>
        <h1>
          {complete
            ? 'Choose your Page'
            : state === 'completing'
              ? 'Completing secure connection...'
              : state === 'expired'
                ? 'Authorization expired'
                : state === 'no_pages'
                  ? 'No Facebook Page was authorized'
                  : 'Connection could not be completed'}
        </h1>
        <p className="auth-copy">
          {complete
            ? 'Authorization was accepted. Return to Social connections to select an eligible Facebook Page.'
            : state === 'authentication_required'
              ? 'Sign in as an authorized company Manager or Admin, then start a new Meta connection.'
              : state === 'completing'
                ? 'ServiceScope is validating the one-time authorization response.'
                : state === 'expired'
                  ? 'This Meta authorization took too long to complete. Return to Social connections and start a new authorization.'
                  : state === 'no_pages'
                    ? 'Return to Social connections, sign in with a Facebook account that can manage the Page, and select it in the Meta authorization dialog.'
                    : 'No connection was saved. Return to Settings and start a new authorization.'}
        </p>
        {state !== 'completing' ? <button className="primary-button" type="button" onClick={() => onReturn(destination, state === 'no_pages')}>Return to ServiceScope</button> : null}
      </section>
    </main>
  );
}
