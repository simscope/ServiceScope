import { useState } from 'react';

export function useBillingFeature() {
  const [billingStatus, setBillingStatus] = useState('');
  const [billingModalOpen, setBillingModalOpen] = useState(false);

  const openBillingSetup = () => {
    setBillingStatus('Opening Square card form...');
    setBillingModalOpen(true);
  };

  const closeBillingSetup = () => {
    setBillingModalOpen(false);
  };

  return {
    billingStatus,
    setBillingStatus,
    billingModalOpen,
    openBillingSetup,
    closeBillingSetup,
  };
}
