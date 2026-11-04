// The browser talks directly to Hono. An empty origin supports a production
// ingress that routes /api to Hono on the same public hostname.
export function productAPIURL(path: string) {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Invalid API path');
  const origin = process.env.NEXT_PUBLIC_API_ORIGIN?.replace(/\/$/, '') || '';
  return `${origin}${path}`;
}
export function productFetch(path: string, init?: RequestInit) {
  return fetch(productAPIURL(path), { ...init, credentials: 'include' });
}
