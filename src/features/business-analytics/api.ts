import { supabaseRequest } from '../../services/supabaseRest';
import type { BusinessAnalyticsResponse } from './types';

export type BusinessAnalyticsRequest = {
  companyId: string;
  dateFrom: string;
  dateTo: string;
  technicianId?: string | null;
};

export async function getBusinessAnalytics({
  companyId,
  dateFrom,
  dateTo,
  technicianId = null,
}: BusinessAnalyticsRequest): Promise<BusinessAnalyticsResponse> {
  return supabaseRequest<BusinessAnalyticsResponse>('rpc/get_business_analytics', {
    method: 'POST',
    body: {
      p_company_id: companyId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_technician_id: technicianId,
    },
    timeoutMs: 30000,
  });
}
