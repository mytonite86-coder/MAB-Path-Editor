import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCheckoutReturn } from '../utils/checkoutReturn.ts';

test('return reconciles owned checkout before authoritative user refresh', async () => {
  for (const premium of [true, false]) {
    const calls: string[] = [];
    const request = (async (url, options) => {
      calls.push(String(url));
      assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer local-token');
      return Response.json(calls.length === 1 ? { product_id: 'mab_s1', payment_status: premium ? 'paid' : 'unpaid' } : { id: 'local-user', is_premium: premium });
    }) as typeof fetch;
    const user = await reconcileCheckoutReturn('http://local.test', 'local-token', 'cs_sample', request);
    assert.equal(user.is_premium, premium);
    assert.deepEqual(calls, ['http://local.test/api/payments/checkout/status/cs_sample', 'http://local.test/api/auth/me']);
  }
});
test('cancel or missing session grants nothing from URL; refreshes actual user', async () => {
  const user = await reconcileCheckoutReturn('http://local.test', 'token', null, (async url => {
    assert.equal(url, 'http://local.test/api/auth/me');
    return Response.json({ id: 'demo', is_premium: false });
  }) as typeof fetch);
  assert.equal(user.is_premium, false);
});
test('failed, foreign and unauthenticated checks cannot return premium user', async () => {
  await assert.rejects(reconcileCheckoutReturn('http://local.test', '', 's'), /Sign in/);
  await assert.rejects(reconcileCheckoutReturn('http://local.test', 't', 's', (async () => new Response('', { status: 403 })) as typeof fetch), /verification/);
  await assert.rejects(reconcileCheckoutReturn('http://local.test', 't', 's', (async () => Response.json({ product_id: 'pathseal' })) as typeof fetch), /not a M.A.B./);
  await assert.rejects(reconcileCheckoutReturn('http://local.test', 't', null, (async () => new Response('', { status: 500 })) as typeof fetch), /refresh failed/);
});
