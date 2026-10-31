"""Block 29 negative delivery checks; fixture signatures, no Stripe service."""
from types import SimpleNamespace
import pytest
from bson import ObjectId
import server
from models import CreateSvgSubscriptionCheckoutRequest
from svg_subscription import SVG_TOOL_CATALOG
from test_svg_commercial_integration import environment, signed_event

@pytest.fixture
def anyio_backend():
    return 'asyncio'

MAB_GRANTS = ['mab_s1', 'mab_s1_subscription', 'founder_lifetime', 'complimentary_lifetime']

async def seed(db):
    uid = ObjectId()
    await db.users.insert_one({'_id': uid, 'entitlements': list(MAB_GRANTS), 'is_premium': True})
    await db.payment_transactions.insert_one({'session_id': 'cs_denied_fixture', 'user_id': str(uid), 'package_id': 'svg_micro_eco_selection', 'product_id': 'svg_micro_eco_selection', 'billing_mode': 'subscription', 'selected_product_ids': ['curve_repair'], 'subscription_id': 'sub_denied_fixture', 'access_active': False})
    return uid

async def assert_mab_unchanged(db, uid):
    user = await db.users.find_one({'_id': uid})
    assert user['entitlements'] == MAB_GRANTS
    assert user['is_premium'] is True
    assert not set(user['entitlements']) & set(SVG_TOOL_CATALOG)

@pytest.mark.anyio
@pytest.mark.parametrize('event_type,status', [
    ('checkout.session.async_payment_failed', 'unpaid'),
    ('checkout.session.completed', 'unpaid'),
])
async def test_failed_or_unpaid_checkout_never_grants_svg_or_changes_mab(environment, event_type, status):
    uid = await seed(environment)
    event = {'id': 'evt_denied_fixture', 'object': 'event', 'type': event_type, 'data': {'object': {'id': 'cs_denied_fixture', 'object': 'checkout.session', 'payment_status': status, 'status': 'complete', 'subscription': 'sub_denied_fixture', 'metadata': {'user_id': str(uid), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'curve_repair'}}}}
    await signed_event(event)
    await signed_event(event)
    await assert_mab_unchanged(environment, uid)
    assert (await environment.payment_transactions.find_one({'session_id': 'cs_denied_fixture'}))['access_active'] is False

@pytest.mark.anyio
@pytest.mark.parametrize('status', ['incomplete', 'incomplete_expired', 'unpaid', 'canceled'])
async def test_incomplete_or_failed_subscription_never_grants_svg(environment, status):
    uid = await seed(environment)
    event = {'id': 'evt_subscription_denied', 'object': 'event', 'type': 'customer.subscription.updated', 'data': {'object': {'id': 'sub_denied_fixture', 'object': 'subscription', 'status': status, 'metadata': {'user_id': str(uid), 'package_id': 'svg_micro_eco_selection', 'selected_product_ids': 'curve_repair'}}}}
    await signed_event(event)
    await assert_mab_unchanged(environment, uid)
    assert (await environment.payment_transactions.find_one({'session_id': 'cs_denied_fixture'}))['access_active'] is False

@pytest.mark.anyio
async def test_unrelated_settled_payment_without_local_transaction_does_not_grant(environment):
    uid = await seed(environment)
    event = {'id': 'evt_unrelated_fixture', 'object': 'event', 'type': 'checkout.session.completed', 'data': {'object': {'id': 'cs_other_product_fixture', 'object': 'checkout.session', 'payment_status': 'paid', 'metadata': {'user_id': str(uid), 'product_id': 'blueprint_ai', 'package_id': 'unrelated_product'}}}}
    await signed_event(event)
    await assert_mab_unchanged(environment, uid)
    assert await environment.payment_transactions.count_documents({}) == 1

@pytest.mark.anyio
async def test_signed_unrelated_event_cannot_change_svg_or_mab(environment):
    uid = await seed(environment)
    await signed_event({'id': 'evt_other', 'object': 'event', 'type': 'payment_intent.succeeded', 'data': {'object': {'id': 'pi_other_fixture', 'metadata': {'user_id': str(uid), 'selected_product_ids': 'curve_repair'}}}})
    await assert_mab_unchanged(environment, uid)

@pytest.mark.anyio
async def test_configured_integration_label_and_single_svg_grant_preserve_mab(environment, monkeypatch):
    uid = await seed(environment)
    label = 'svg_micro_eco_checkout_kvhrmtps'
    monkeypatch.setenv('STRIPE_SVG_INTEGRATION_IDENTIFIER', label)
    captured = {}
    def create(parameters):
        captured.update(parameters)
        return SimpleNamespace(id='cs_configuration_fixture', url='https://checkout.stripe.com/c/pay/cs_configuration_fixture')
    monkeypatch.setattr(server, 'STRIPE_API_KEY', 'fixture_key')
    monkeypatch.setattr(server.stripe, 'StripeClient', lambda *args: SimpleNamespace(v1=SimpleNamespace(checkout=SimpleNamespace(sessions=SimpleNamespace(create=create)))))
    await server.create_svg_subscription_checkout_session(CreateSvgSubscriptionCheckoutRequest(selected_product_ids=['stray_node_cleaner'], origin_url='https://mytonite86-coder.github.io/svg-path-closer/index.html'), None, {'user_id': str(uid), 'email': 'configuration@example.invalid'})
    assert captured['integration_identifier'] == label
    assert len(label.rsplit('_', 1)[1]) == 8 and label.rsplit('_', 1)[1].isalpha()
    # Bind the known fixture transaction just as checkout completion does.
    await environment.payment_transactions.update_one({'session_id': 'cs_configuration_fixture'}, {'$set': {'subscription_id': 'sub_configuration_fixture'}})
    event = {'id': 'evt_configured_fixture', 'object': 'event', 'type': 'checkout.session.completed', 'data': {'object': {'id': 'cs_configuration_fixture', 'mode': 'payment', 'status': 'complete', 'payment_status': 'paid', 'currency': 'usd', 'amount_total': 999, 'metadata': captured['metadata']}}}
    await signed_event(event)
    await signed_event(event)
    user = await environment.users.find_one({'_id': uid})
    assert set(user['entitlements']) == set(MAB_GRANTS) | {'stray_node_cleaner'}
    assert len(user['entitlements']) == len(MAB_GRANTS) + 1
    assert user['is_premium'] is True
