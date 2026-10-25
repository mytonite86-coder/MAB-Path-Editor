/** Reconcile through existing authenticated server endpoints; URL flags grant nothing. */
export async function reconcileCheckoutReturn(api: string, token: string, session: string | null, request: typeof fetch = fetch) {
  if (!token) throw new Error('Sign in again to check your access.');
  const headers = { Authorization: `Bearer ${token}` };
  if (session) {
    const status = await request(`${api}/api/payments/checkout/status/${encodeURIComponent(session)}`, { headers });
    if (!status.ok) throw new Error('Payment verification is unavailable. Demo restrictions remain; reload to retry.');
    const payment = await status.json();
    if (payment.product_id !== 'mab_s1') throw new Error('This return is not a M.A.B. checkout. Demo restrictions remain.');
  }
  const response = await request(`${api}/api/auth/me`, { headers });
  if (!response.ok) throw new Error('Access refresh failed. Demo restrictions remain; reload to retry.');
  const user = await response.json();
  if (!user || typeof user.id !== 'string' || typeof user.is_premium !== 'boolean') throw new Error('Invalid access response. Demo restrictions remain.');
  return user;
}
