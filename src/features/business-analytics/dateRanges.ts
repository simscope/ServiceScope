export type BusinessAnalyticsPeriodPreset = 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'custom';

export type BusinessAnalyticsDateRange = {
  from: string;
  to: string;
};

export function toLocalDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function rangeForBusinessAnalyticsPreset(
  preset: BusinessAnalyticsPeriodPreset,
  today = new Date(),
): BusinessAnalyticsDateRange {
  if (preset === 'last7') {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: toLocalDateInputValue(from), to: toLocalDateInputValue(today) };
  }

  if (preset === 'last90') {
    const from = new Date(today);
    from.setDate(today.getDate() - 89);
    return { from: toLocalDateInputValue(from), to: toLocalDateInputValue(today) };
  }

  if (preset === 'thisMonth') {
    return { from: toLocalDateInputValue(startOfMonth(today)), to: toLocalDateInputValue(today) };
  }

  if (preset === 'lastMonth') {
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return {
      from: toLocalDateInputValue(startOfMonth(lastMonth)),
      to: toLocalDateInputValue(endOfMonth(lastMonth)),
    };
  }

  const from = new Date(today);
  from.setDate(today.getDate() - 29);
  return { from: toLocalDateInputValue(from), to: toLocalDateInputValue(today) };
}

export function businessAnalyticsLocalDateSmokeCheck() {
  return toLocalDateInputValue(new Date(2026, 6, 14, 21, 0, 0)) === '2026-07-14';
}
