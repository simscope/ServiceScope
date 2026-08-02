import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { completeMetaConnection } from './clientApi';
import type { MetaOAuthCallbackPayload, MetaReturnDestination } from './contracts';

type CallbackState = 'idle' | 'completing' | 'complete' | 'expired' | 'error' | 'authentication_required';

export function MetaOAuthCallbackPage({
  callback,
  authenticated,
  allowedRole,
  onReturn,
}: {
  callback: MetaOAuthCallbackPayload;
  authenticated: boolean;
  allowedRole: boolean;
  onReturn: (destination: MetaReturnDestination) => void;
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
        setState(error instanceof Error && error.message.includes('OAUTH_STATE_EXPIRED') ? 'expired' : 'error');
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
                  : 'No connection was saved. Return to Settings and start a new authorization.'}
        </p>
        {state !== 'completing' ? <button className="primary-button" type="button" onClick={() => onReturn(destination)}>Return to ServiceScope</button> : null}
      </section>
    </main>
  );
}
