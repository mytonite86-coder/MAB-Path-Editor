"""Focused Block 28 tests: local signatures and in-memory database only."""
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient
import server
from models import CreateSvgSubscriptionCheckoutRequest
from svg_subscription import SVG_TOOL_CATALOG, SVG_TOOL_PRICE_ENV, SVG_DISCOUNT_COUPON_ENV, SVG_PRICE_IDS
from test_stripe_webhook_boundary import FakeRequest

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.fixture
def environment(monkeypatch):
    client = AsyncMongoMockClient()
    db = client.block28_fixture
    monkeypatch.setattr(server, 'users_collection', db.users)
    monkeypatch.setattr(server, 'payment_transactions_collection', db.payment_transactions)
    monkeypatch.setattr(server, 'forward_signaldrift_event', AsyncMock())
    monkeypatch.setenv('SVG_SUBSCRIPTION_CHECKOUT_ENABLED', '1')
    monkeypatch.setenv('STRIPE_SVG_INTEGRATION_IDENTIFIER', 'svg_fixture_abcdefgh')
    monkeypatch.setenv('STRIPE_WEBHOOK_SECRET', 'whsec_block28_fixture_only')
    for pid, key in SVG_TOOL_PRICE_ENV.items(): monkeypatch.setenv(key, SVG_PRICE_IDS[pid])
    for key in SVG_DISCOUNT_COUPON_ENV.values(): monkeypatch.setenv(key, 'coupon_fixture_' + key.lower())
    yield db
    client.close()

async def signed_event(event, invalid=False):
    payload = json.dumps(event, separators=(',', ':')).encode()
    timestamp = int(time.time())
    sig = hmac.new(b'whsec_block28_fixture_only', f'{timestamp}.'.encode() + payload, hashlib.sha256).hexdigest()
    return await server.stripe_webhook(FakeRequest(payload, f't={timestamp},v1={"0" * 64 if invalid else sig}'))

@pytest.mark.anyio
async def test_subscription_owner_or_bound_id_mismatch_never_grants(environment):
    owner, attacker = ObjectId(), ObjectId()
    for uid in [owner, attacker]: await environment.users.insert_one({'_id': uid, 'entitlements': []})
    await environment.payment_transactions.insert_one({'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'subscription_id': 'sub_owner', 'selected_product_ids': ['curve_repair']})
    assert not await server.sync_product_subscription({'id': 'sub_owner', 'status': 'active', 'metadata': {'user_id': str(attacker), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'curve_repair'}})
    assert not await server.sync_product_subscription({'id': 'sub_other', 'status': 'active', 'metadata': {'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'curve_repair'}})
    for uid in [owner, attacker]: assert (await environment.users.find_one({'_id': uid}))['entitlements'] == []

@pytest.mark.anyio
async def test_pending_selection_mismatch_and_other_owner_status_denied(environment):
    owner = ObjectId()
    await environment.users.insert_one({'_id': owner, 'entitlements': []})
    await environment.payment_transactions.insert_one({'session_id': 'cs_pending', 'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': ['curve_repair']})
    assert not await server.sync_product_subscription({'id': 'sub_pending', 'status': 'active', 'metadata': {'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'pathseal'}})
    with pytest.raises(HTTPException) as error:
        await server.get_checkout_status('cs_pending', None, {'user_id': str(ObjectId())})
    assert error.value.status_code == 404
    assert (await environment.users.find_one({'_id': owner}))['entitlements'] == []

@pytest.mark.anyio
async def test_shared_cancel_preserves_independent_active_pathseal(environment):
    owner = ObjectId()
    await environment.users.insert_one({'_id': owner, 'entitlements': ['pathseal']})
    await environment.payment_transactions.insert_one({'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'subscription_id': 'sub_shared', 'selected_product_ids': ['pathseal'], 'access_active': True})
    await environment.payment_transactions.insert_one({'user_id': str(owner), 'product_id': 'pathseal', 'subscription_id': 'sub_direct', 'access_active': True})
    assert await server.sync_product_subscription({'id': 'sub_shared', 'status': 'canceled', 'metadata': {'user_id': str(owner), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'pathseal'}})
    assert (await environment.users.find_one({'_id': owner}))['entitlements'] == ['pathseal']
