import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type ImportRequest = {
  companyId?: string;
  url?: string;
};

type ProviderStatus = 'complete' | 'partial' | 'blocked';
type SourceType = 'amazon' | 'ebay' | 'generic';

type ImportedProduct = {
  sourceType: SourceType;
  providerStatus: ProviderStatus;
  sourceDomain: string;
  externalProductId: string;
  asin: string;
  ebayItemId: string;
  title: string;
  brand: string;
  manufacturer: string;
  partNumber: string;
  model: string;
  oem: string;
  description: string;
  imageUrl: string;
  sourceImageUrl: string;
  vendorPrice: number;
  currency: string;
  packQuantity: number;
  supplierName: string;
  canonicalUrl: string;
  confidence: Record<string, { source: string; score: number }>;
  warnings: string[];
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_HTML_BYTES = 1_500_000;
const MAX_IMAGE_BYTES = 4_000_000;
const REDIRECT_LIMIT = 4;
const FETCH_TIMEOUT_MS = 9000;
const IMAGE_TIMEOUT_MS = 8000;
const INVENTORY_IMAGE_BUCKET = 'inventory-images';
const PRIVATE_HOSTS = new Set(['localhost', 'metadata.google.internal']);
const BLOCKED_IPS = new Set(['0.0.0.0', '127.0.0.1', '169.254.169.254', '::1']);
const PLACEHOLDER_VALUES = new Set(['unknown', 'n/a', 'na', 'none', 'null', 'undefined', 'not available', 'unavailable']);
const BLOCKED_PAGE_PATTERNS = [
  /whoops[,! ]/i,
  /access denied/i,
  /forbidden/i,
  /captcha/i,
  /robot check/i,
  /page not found/i,
  /request blocked/i,
  /we couldn't find that/i,
  /verify you are human/i,
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
}

function normalizeUrl(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS product links are supported.');
  }
  parsed.hash = '';
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'tag', 'ascsubtag'].forEach((key) => parsed.searchParams.delete(key));
  return parsed.toString();
}

function hostLooksUnsafe(hostname: string) {
  const host = hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (BLOCKED_IPS.has(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^127\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return true;
  return false;
}

function assertSafeUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only HTTP and HTTPS product links are supported.');
  if (hostLooksUnsafe(parsed.hostname)) throw new Error('This product link points to a blocked private or local address.');
  return parsed;
}

async function fetchSafeText(url: string, redirects = 0): Promise<{ url: string; html: string; contentType: string; status: number }> {
  const parsed = assertSafeUrl(url);
  if (redirects > REDIRECT_LIMIT) throw new Error('Too many redirects while reading product link.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'User-Agent': 'ServiceScopeInventoryImporter/1.0',
        Accept: 'text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.5',
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Product link redirected without a destination.');
      return fetchSafeText(new URL(location, parsed).toString(), redirects + 1);
    }

    if (!response.ok) throw new Error(`Product page returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml|application\/ld\+json|application\/json/i.test(contentType)) {
      throw new Error('Product link did not return a supported HTML or JSON content type.');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('Product page response was empty.');
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > MAX_HTML_BYTES) throw new Error('Product page is too large to import safely.');
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { url: response.url || parsed.toString(), html: new TextDecoder().decode(bytes), contentType, status: response.status };
  } finally {
    clearTimeout(timeout);
  }
}

function text(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/<[^>]+>/g, '').trim().slice(0, 1200);
}

function cleanValue(value: unknown) {
  const clean = text(value);
  return PLACEHOLDER_VALUES.has(clean.toLowerCase()) ? '' : clean;
}

function attr(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return cleanValue(match?.[1] ?? '');
}

function parseMoney(value: unknown) {
  const clean = String(value ?? '').replace(/,/g, '').match(/\d+(?:\.\d{1,4})?/);
  return clean ? Number(clean[0]) || 0 : 0;
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function isTokenLikePartNumber(value: string) {
  const clean = value.trim();
  if (!clean) return false;
  if (clean.length > 48) return true;
  if (/^[a-f0-9]{24,}$/i.test(clean)) return true;
  if (/^[A-Za-z0-9+/=_-]{28,}$/.test(clean)) return true;
  if (/challenge|captcha|token|akamai|cloudflare|datadome|bot/i.test(clean)) return true;
  if (/^[A-Z0-9]{18,}$/i.test(clean) && !/[._-]/.test(clean)) return true;
  return false;
}

function cleanPartNumber(value: unknown, warnings: string[]) {
  const clean = cleanValue(value).replace(/^#/, '').trim();
  if (!clean) return '';
  if (isTokenLikePartNumber(clean)) {
    warnings.push('Imported Part Number looked like a challenge token and was cleared. Enter it manually.');
    return '';
  }
  return clean.slice(0, 80);
}

function detectBlockedPage(html: string) {
  const sample = html.slice(0, 180_000);
  return BLOCKED_PAGE_PATTERNS.some((pattern) => pattern.test(sample));
}

function extractJsonLdProducts(html: string) {
  const products: Record<string, unknown>[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(regex)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        const graph = Array.isArray(candidate?.['@graph']) ? candidate['@graph'] : [candidate];
        for (const node of graph) {
          const type = node?.['@type'];
          if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) products.push(node);
        }
      }
    } catch {
      // Ignore malformed third-party structured data.
    }
  }
  return products;
}

function confidence(source: string, score: number) {
  return { source, score };
}

function baseResult(url: URL, canonicalUrl: string): ImportedProduct {
  const host = url.hostname.replace(/^www\./, '');
  return {
    sourceType: host.includes('amazon.') ? 'amazon' : host.includes('ebay.') ? 'ebay' : 'generic',
    providerStatus: 'complete',
    sourceDomain: host,
    externalProductId: '',
    asin: '',
    ebayItemId: '',
    title: '',
    brand: '',
    manufacturer: '',
    partNumber: '',
    model: '',
    oem: '',
    description: '',
    imageUrl: '',
    sourceImageUrl: '',
    vendorPrice: 0,
    currency: 'USD',
    packQuantity: 1,
    supplierName: host,
    canonicalUrl,
    confidence: {},
    warnings: [],
  };
}

function asinFromUrl(url: URL) {
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match?.[1]?.toUpperCase() ?? '';
}

function ebayItemIdFromUrl(url: URL) {
  return url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,})/i)?.[1] ?? url.searchParams.get('itm') ?? '';
}

function parsePackQuantity(title: string) {
  const match = title.match(/\b(?:pack of|case of|box of|set of)\s*(\d{1,4})\b/i) ?? title.match(/\b(\d{1,4})\s*(?:pack|pcs|pieces|count|ct)\b/i);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

function mergeProductFromHtml(result: ImportedProduct, html: string) {
  const product = extractJsonLdProducts(html)[0];
  if (product) {
    result.title = cleanValue(product.name) || result.title;
    result.brand = cleanValue(typeof product.brand === 'object' ? objectValue(product.brand).name : product.brand) || result.brand;
    result.manufacturer = cleanValue(product.manufacturer) || result.manufacturer || result.brand;
    result.partNumber = cleanPartNumber(product.mpn ?? product.sku, result.warnings) || result.partNumber;
    result.model = cleanValue(product.model) || result.model;
    result.description = cleanValue(product.description) || result.description;
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    result.imageUrl = cleanValue(image) || result.imageUrl;
    const offer = Array.isArray(product.offers) ? product.offers[0] : product.offers as Record<string, unknown> | undefined;
    result.vendorPrice = parseMoney(offer?.price ?? product.price) || result.vendorPrice;
    result.currency = cleanValue(offer?.priceCurrency) || result.currency;
    result.confidence.title = confidence('json-ld', 0.95);
    result.confidence.partNumber = confidence('json-ld', result.partNumber ? 0.85 : 0);
    result.confidence.vendorPrice = confidence('json-ld', result.vendorPrice ? 0.85 : 0);
  }

  result.title ||= attr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  result.description ||= attr(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i);
  result.imageUrl ||= attr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  result.canonicalUrl = attr(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i) || result.canonicalUrl;
  result.vendorPrice ||= parseMoney(attr(html, /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i));
  result.currency = attr(html, /<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i) || result.currency;
  result.partNumber ||= cleanPartNumber(attr(html, /(?:MPN|Part Number|Manufacturer Part Number|Model)[\s\S]{0,120}?([A-Z0-9][A-Z0-9._-]{2,})/i), result.warnings);
  result.packQuantity = parsePackQuantity(result.title);
  if (!result.confidence.title && result.title) result.confidence.title = confidence('html-meta', 0.65);
  if (!result.confidence.partNumber && result.partNumber) result.confidence.partNumber = confidence('sanitized-text', 0.45);
}

function ebayApiBase() {
  return Deno.env.get('EBAY_API_BASE_URL') || 'https://api.ebay.com';
}

async function getEbayApplicationToken() {
  const clientId = Deno.env.get('EBAY_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('EBAY_CLIENT_SECRET') ?? '';
  if (!clientId || !clientSecret) return '';
  const response = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  if (!response.ok) return '';
  const token = await response.json();
  return cleanValue(token.access_token);
}

async function importEbay(url: URL, result: ImportedProduct) {
  const itemId = ebayItemIdFromUrl(url);
  result.ebayItemId = itemId;
  result.externalProductId = itemId;
  result.supplierName = 'eBay';
  result.canonicalUrl = itemId ? `https://www.ebay.com/itm/${itemId}` : result.canonicalUrl;
  if (!itemId) result.warnings.push('Could not find an eBay item ID in this URL.');

  const token = itemId ? await getEbayApplicationToken() : '';
  if (!itemId || !token) {
    result.providerStatus = 'blocked';
    result.warnings.push('eBay blocked the page and the eBay API is not available.');
    return result;
  }

  const response = await fetch(`${ebayApiBase()}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(itemId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    result.providerStatus = 'blocked';
    result.warnings.push(`eBay Browse API returned HTTP ${response.status}. Enter the fields manually.`);
    return result;
  }

  const item = await response.json();
  const aspects = item.localizedAspects ?? [];
  const aspect = (name: string) => cleanValue(aspects.find((row: Record<string, unknown>) => String(row.name).toLowerCase() === name.toLowerCase())?.value);
  result.title = cleanValue(item.title);
  result.imageUrl = cleanValue(item.image?.imageUrl);
  result.vendorPrice = parseMoney(item.price?.value);
  result.currency = cleanValue(item.price?.currency) || 'USD';
  result.brand = aspect('Brand');
  result.manufacturer = result.brand;
  result.partNumber = cleanPartNumber(aspect('MPN') || aspect('Manufacturer Part Number'), result.warnings);
  result.model = aspect('Model');
  result.description = cleanValue(item.shortDescription);
  result.canonicalUrl = cleanValue(item.itemWebUrl) || result.canonicalUrl;
  result.confidence.title = confidence('ebay-browse-api', 0.98);
  result.confidence.partNumber = confidence('ebay-browse-api', result.partNumber ? 0.9 : 0);
  result.confidence.vendorPrice = confidence('ebay-browse-api', result.vendorPrice ? 0.95 : 0);
  result.providerStatus = result.title && result.vendorPrice ? 'complete' : 'partial';
  return result;
}

function absoluteUrl(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

async function copyImageToStorage(serviceClient: ReturnType<typeof createClient>, companyId: string, imageUrl: string, warnings: string[]) {
  const safeUrl = absoluteUrl(imageUrl, 'https://example.com');
  if (!safeUrl) return '';
  assertSafeUrl(safeUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(safeUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ServiceScopeInventoryImporter/1.0',
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      },
    });
    if (!response.ok) {
      warnings.push('Product image could not be copied; stock import can continue.');
      return '';
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpe?g|webp|gif|avif)$/i.test(contentType)) {
      warnings.push('Product image had an unsupported file type and was skipped.');
      return '';
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
      warnings.push('Product image was empty or too large and was skipped.');
      return '';
    }
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : contentType.includes('avif') ? 'avif' : 'jpg';
    const path = `${companyId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await serviceClient.storage.from(INVENTORY_IMAGE_BUCKET).upload(path, bytes, { contentType, upsert: true });
    if (error) {
      warnings.push('Product image could not be saved to Storage; stock import can continue.');
      console.error('inventory image upload failed', error.message);
      return '';
    }
    const { data } = serviceClient.storage.from(INVENTORY_IMAGE_BUCKET).getPublicUrl(path);
    return data.publicUrl || '';
  } catch (error) {
    warnings.push('Product image could not be copied; stock import can continue.');
    console.error('inventory image copy failed', error);
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeResult(result: ImportedProduct) {
  result.title = cleanValue(result.title);
  result.brand = cleanValue(result.brand);
  result.manufacturer = cleanValue(result.manufacturer);
  result.partNumber = cleanPartNumber(result.partNumber, result.warnings);
  result.model = cleanValue(result.model);
  result.oem = cleanValue(result.oem);
  result.description = cleanValue(result.description);
  result.externalProductId = cleanValue(result.externalProductId);
  result.asin = cleanValue(result.asin);
  result.ebayItemId = cleanValue(result.ebayItemId);
  result.supplierName = cleanValue(result.supplierName) || result.sourceDomain;
  result.canonicalUrl = cleanValue(result.canonicalUrl);
  if (result.providerStatus === 'complete' && (!result.title || result.warnings.length)) result.providerStatus = 'partial';
  return result;
}

function blockedMessage(result: ImportedProduct) {
  if (result.sourceDomain.includes('grainger.')) return 'Grainger blocked automatic product import. Enter the fields manually.';
  if (result.sourceType === 'ebay') return 'eBay blocked the page and the eBay API is not available.';
  return 'Product page is blocked or not a product page. Enter the fields manually.';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Importer function is missing Supabase environment secrets.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Missing authenticated caller.' }, 401);

  try {
    const payload = (await request.json().catch(() => ({}))) as ImportRequest;
    const companyId = payload.companyId?.trim() ?? '';
    const inputUrl = payload.url?.trim() ?? '';
    if (!companyId || !inputUrl) return jsonResponse({ error: 'Company and product link are required.' }, 400);

    const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
    if (sessionError) return jsonResponse({ error: sessionError.message }, 401);
    const session = Array.isArray(sessionRows) ? sessionRows[0] : null;
    const role = String(session?.role ?? '').toLowerCase();
    const canManage = session?.kind === 'owner' || (session?.kind === 'company' && session?.company_id === companyId && (role === 'admin' || role === 'manager'));
    if (!canManage) return jsonResponse({ error: 'Current login cannot manage this warehouse.' }, 403);

    const normalized = normalizeUrl(inputUrl);
    const inputParsed = assertSafeUrl(normalized);
    let result = baseResult(inputParsed, normalized);

    if (result.sourceType === 'ebay') {
      result = await importEbay(inputParsed, result);
      return jsonResponse(sanitizeResult(result));
    }

    const fetchResult = await fetchSafeText(normalized);
    const finalUrl = assertSafeUrl(fetchResult.url);
    result = baseResult(finalUrl, fetchResult.url);

    if (detectBlockedPage(fetchResult.html)) {
      result.providerStatus = 'blocked';
      result.warnings.push(blockedMessage(result));
      return jsonResponse(sanitizeResult(result));
    }

    const asin = asinFromUrl(finalUrl);
    if (asin) {
      result.asin = asin;
      result.externalProductId = asin;
      result.supplierName = 'Amazon';
      result.canonicalUrl = `https://www.amazon.com/dp/${asin}`;
      mergeProductFromHtml(result, fetchResult.html);
      result.partNumber = '';
      result.providerStatus = 'partial';
      result.warnings.push('Amazon import is partial. Price, image, manufacturer, and Part Number may require manual entry.');
      if (!result.title) result.title = `Amazon product ${asin}`;
    } else {
      mergeProductFromHtml(result, fetchResult.html);
      if (!result.partNumber) result.warnings.push('No valid Part Number was found. Verify before creating a new part.');
      if (!result.vendorPrice) result.warnings.push('No price was found. Enter Price each or Price per pack manually.');
    }

    result = sanitizeResult(result);
    result.sourceImageUrl = result.imageUrl;
    if (result.imageUrl) {
      const copiedImageUrl = await copyImageToStorage(serviceClient, companyId, result.imageUrl, result.warnings);
      if (copiedImageUrl) result.imageUrl = copiedImageUrl;
    }

    return jsonResponse(sanitizeResult(result));
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'Product link could not be imported.';
    console.error('inventory product import failed', raw);
    let message = raw;
    if (/HTTP 403|Forbidden/i.test(raw)) message = 'Product page blocked automatic import. Enter the fields manually.';
    return jsonResponse({ error: message }, 400);
  }
});
