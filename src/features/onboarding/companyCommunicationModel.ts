import type { EmailConnection } from '../../appTypes';
import { paymentMethodLabels } from '../../appLabels';
import type { Company, CompanyOnboardingProfile } from '../../types';

type CompanyCommunicationInput = {
  company: Company;
  profile: CompanyOnboardingProfile;
  emailConnection: EmailConnection | null;
};

export function makeCompanyCommunicationModel({
  company,
  profile,
  emailConnection,
}: CompanyCommunicationInput) {
  const generatedCompanyEmailSignature = [
    '--',
    profile.displayName || company.name,
    profile.serviceAddress,
    profile.phone ? `Phone: ${profile.phone}` : '',
    profile.website ? `Website: ${profile.website}` : '',
    'HVAC and Appliance Repair',
    profile.serviceArea ? `Services Licensed & Insured | Serving ${profile.serviceArea}` : 'Services Licensed & Insured',
  ].filter(Boolean).join('\n');
  const companyEmailSignature = emailConnection?.signature.trim() || generatedCompanyEmailSignature;
  const paymentLines = profile.acceptedPayments.flatMap((method) => {
    if (method === 'zelle') return [`Zelle: ${profile.zelleContact || profile.billingEmail || emailConnection?.address || company.ownerEmail}`];
    if (method === 'ach') {
      return [
        'ACH Transfer',
        profile.achAccountNumber ? `Account number: ${profile.achAccountNumber}` : '',
        profile.achRoutingNumber ? `Routing number: ${profile.achRoutingNumber}` : '',
      ].filter(Boolean);
    }
    if (method === 'credit_card') return ['Credit Card'];
    if (method === 'debit_card') return ['Debit Card'];
    if (method === 'check') return [`Check payable to: ${profile.achAccountName || profile.legalName || company.name}`];
    if (method === 'cash') return ['Cash'];
    if (method === 'paypal') return [`PayPal: ${profile.paypalEmail || profile.billingEmail || emailConnection?.address || company.ownerEmail}`];
    if (method === 'venmo') return [`Venmo: ${profile.venmoContact || 'available on request'}`];
    if (method === 'cash_app') return [`Cash App: ${profile.cashAppCashtag || 'available on request'}`];
    if (method === 'stripe') return ['Stripe payment link available on request'];
    if (method === 'square') return ['Square invoice/payment link available on request'];
    if (method === 'wire_transfer') return ['Wire transfer details available on request'];
    if (method === 'apple_pay') return ['Apple Pay available'];
    if (method === 'google_pay') return ['Google Pay available'];
    if (method === 'financing') return ['Financing options available on request'];
    return [paymentMethodLabels[method]];
  });
  const companyPaymentBlock = [
    'Payment Options:',
    ...paymentLines,
    profile.serviceAddress ? `Mailing address: ${profile.serviceAddress}` : '',
    profile.paymentNotes,
  ].filter(Boolean).join('\n');
  const paymentMethodOptions = profile.acceptedPayments.map((method) => ({
    value: method,
    label: paymentMethodLabels[method],
  }));

  return {
    companyEmailSignature,
    companyPaymentBlock,
    paymentMethodOptions,
  };
}
