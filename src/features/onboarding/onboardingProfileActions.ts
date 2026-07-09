import type { MutableRefObject } from 'react';
import type { EmailConnection } from '../../appTypes';
import { saveOnboardingProfileToBackend } from '../../services/onboardingBackend';
import type { Company, CompanyOnboardingProfile, CompanyPaymentMethod } from '../../types';

type OnboardingProfileActionsInput = {
  activeCompany?: Company;
  profile?: CompanyOnboardingProfile;
  emailConnection?: EmailConnection;
  onboardingSaveQueueRef: MutableRefObject<Promise<unknown>>;
  openBillingSetup: () => void;
  onUpdateOnboardingProfile: (profile: CompanyOnboardingProfile) => void;
};

export function makeOnboardingProfileActions({
  activeCompany,
  profile,
  emailConnection,
  onboardingSaveQueueRef,
  openBillingSetup,
  onUpdateOnboardingProfile,
}: OnboardingProfileActionsInput) {
  function persistOnboardingToBackend(nextProfile: CompanyOnboardingProfile, nextEmailConnection = emailConnection) {
    if (!activeCompany) return;

    onboardingSaveQueueRef.current = onboardingSaveQueueRef.current
      .catch(() => undefined)
      .then(() =>
        saveOnboardingProfileToBackend(activeCompany, nextProfile, nextEmailConnection, {
          saveCompanyCore: false,
          saveOnboardingSteps: false,
          saveSubscriptionPaymentMethod: false,
        }),
      )
      .catch((error) => {
        console.error('Failed to save onboarding to backend', error);
      });
  }

  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {
    if (!profile) return;

    const nextProfile = { ...profile, ...updates };
    onUpdateOnboardingProfile(nextProfile);
    persistOnboardingToBackend(nextProfile);
  }

  function connectSubscriptionBilling() {
    openBillingSetup();
    updateProfile({ subscriptionPaymentStatus: 'pending' });
  }

  function togglePaymentMethod(method: CompanyPaymentMethod) {
    if (!profile) return;

    const acceptedPayments = profile.acceptedPayments.includes(method)
      ? profile.acceptedPayments.filter((paymentMethod) => paymentMethod !== method)
      : [...profile.acceptedPayments, method];

    updateProfile({ acceptedPayments });
  }

  return {
    persistOnboardingToBackend,
    updateProfile,
    connectSubscriptionBilling,
    togglePaymentMethod,
  };
}
