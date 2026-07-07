import { FormEvent, useEffect, useRef, useState } from 'react';
import { confirmSubscriptionBillingSetup, startSubscriptionBillingSetup } from '../../services/billingConnector';
import type { Company, CompanyOnboardingProfile } from '../../types';

type SquareCard = {
  attach: (selector: string) => Promise<void>;
  tokenize: (details: Record<string, unknown>) => Promise<{
    status: string;
    token?: string;
    errors?: Array<{ message?: string; detail?: string }>;
  }>;
  destroy?: () => Promise<void>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
};

declare global {
  interface Window {
    Square?: {
      payments: (applicationId: string, locationId: string) => SquarePayments;
    };
  }
}

function loadSquareScript(environment: 'sandbox' | 'production') {
  const scriptUrl = environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

  const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
  if (existingScript) {
    return new Promise<void>((resolve, reject) => {
      if (window.Square) {
        resolve();
        return;
      }
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Square.js failed to load.')), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Square.js failed to load.')), { once: true });
    document.head.appendChild(script);
  });
}

export function SquareBillingModal({
  activeCompany,
  profile,
  onClose,
  onConnected,
}: {
  activeCompany: Company;
  profile: CompanyOnboardingProfile;
  onClose: () => void;
  onConnected: (updates: Partial<CompanyOnboardingProfile>, status: string) => void;
}) {
  const cardRef = useRef<SquareCard | null>(null);
  const [status, setStatus] = useState('Loading Square card form...');
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function setupSquareCard() {
      try {
        const config = await startSubscriptionBillingSetup({
          companyId: activeCompany.id,
          billingName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
          billingZip: profile.subscriptionBillingZip,
          email: profile.billingEmail || activeCompany.ownerEmail,
        });

        await loadSquareScript(config.environment);
        if (!window.Square) {
          throw new Error('Square.js is not available.');
        }

        const payments = window.Square.payments(config.applicationId, config.locationId);
        const card = await payments.card();
        if (cancelled) {
          await card.destroy?.();
          return;
        }

        await card.attach('#square-card-container');
        cardRef.current = card;
        setReady(true);
        setStatus('Enter a card to connect automatic billing.');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Square card form failed to load.');
      }
    }

    setupSquareCard();

    return () => {
      cancelled = true;
      void cardRef.current?.destroy?.();
      cardRef.current = null;
    };
  }, [activeCompany.id, activeCompany.name, activeCompany.ownerEmail, activeCompany.ownerName, profile.billingEmail, profile.subscriptionBillingName, profile.subscriptionBillingZip]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cardRef.current || submitting) return;

    setSubmitting(true);
    setStatus('Saving card in Square...');

    try {
      const tokenResult = await cardRef.current.tokenize({
        intent: 'STORE',
        customerInitiated: true,
        sellerKeyedIn: false,
        currencyCode: 'USD',
        billingContact: {
          givenName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
          email: profile.billingEmail || activeCompany.ownerEmail,
          addressLines: profile.serviceAddress ? [profile.serviceAddress] : [],
          postalCode: profile.subscriptionBillingZip || undefined,
          countryCode: 'US',
        },
      });

      if (tokenResult.status !== 'OK' || !tokenResult.token) {
        const detail = tokenResult.errors?.map((error) => error.message || error.detail).filter(Boolean).join(' ');
        throw new Error(detail || 'Square could not tokenize this card.');
      }

      const result = await confirmSubscriptionBillingSetup({
        companyId: activeCompany.id,
        sourceId: tokenResult.token,
        billingName: profile.subscriptionBillingName || activeCompany.ownerName || activeCompany.name,
        billingZip: profile.subscriptionBillingZip,
        email: profile.billingEmail || activeCompany.ownerEmail,
      });

      onConnected({
        subscriptionPaymentStatus: 'active',
        subscriptionCardBrand: result.brand,
        subscriptionCardLast4: result.last4,
        subscriptionCardExpMonth: result.expMonth,
        subscriptionCardExpYear: result.expYear,
        subscriptionBillingName: result.billingName || profile.subscriptionBillingName,
        subscriptionBillingZip: result.billingZip || profile.subscriptionBillingZip,
        autoPayEnabled: true,
      }, 'Square payment method connected.');
      onClose();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Square billing setup failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="email-message-modal-backdrop" role="presentation" onClick={onClose}>
      <section className="email-message-modal square-billing-modal" role="dialog" aria-modal="true" aria-label="Connect Square billing" onClick={(event) => event.stopPropagation()}>
        <div className="email-message-detail-header">
          <div>
            <p className="eyebrow">ServiceScope subscription</p>
            <h2>Connect Square card</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="square-billing-form" onSubmit={handleSubmit}>
          <div className="square-billing-summary">
            <strong>{activeCompany.plan} plan</strong>
            <span>ServiceScope will use this card for automatic monthly charges.</span>
          </div>

          <div id="square-card-container" className="square-card-container" />

          <p className="subscription-safe-note">
            Card entry is handled by Square. ServiceScope stores only the Square card id and card summary.
          </p>
          {status ? <p className="access-status">{status}</p> : null}

          <div className="email-message-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={!ready || submitting}>
              {submitting ? 'Saving card...' : 'Save Square card'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
