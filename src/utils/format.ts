export function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function statusClassName(status: string) {
  return status.toLowerCase().replace(/\s+/g, '-');
}

export function googleRouteUrl(addresses: string[]) {
  const cleanAddresses = addresses.map((address) => address.trim()).filter(Boolean);

  if (cleanAddresses.length === 0) return '';
  if (cleanAddresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanAddresses[0])}`;
  }

  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(cleanAddresses[0])}&destination=${encodeURIComponent(cleanAddresses[cleanAddresses.length - 1])}&waypoints=${cleanAddresses.slice(1, -1).map(encodeURIComponent).join('|')}`;
}
