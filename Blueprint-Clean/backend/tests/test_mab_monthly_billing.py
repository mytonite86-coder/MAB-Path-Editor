import os
from types import SimpleNamespace

import pytest
import stripe
from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

import server
from models import CreateCheckoutSessionRequest


@pytest.fixture
def isolated_collections(monkeypatch):
    client = AsyncMongoMockClient()
    database = client.mab_s1_25_billing_test
    monkeypatch.setattr(server, "users_collection", database.users)
    monkeypatch.setattr(
        server,
        "payment_transactions_collection",
        database.payment_transactions,
    )
    yield database
    client.close()


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_new_price_checkout_preserves_existing_records(isolated_collections, monkeypatch):
    captured = {}
    def create_session(**params):
        captured.update(params)
        return SimpleNamespace(id="cs_test_price_only", url="https://checkout.stripe.com/test")
    monkeypatch.setattr(server, "configure_stripe", lambda: None)
    monkeypatch.setattr(server.stripe.checkout.Session, "create", create_session)
    old_user = {"_id": ObjectId(), "is_premium": True, "entitlements": ["founder_lifetime"]}
    old_transaction = {"_id": ObjectId(), "session_id": "old_session", "amount": 7.99, "subscription_id": "existing_subscription"}
    await isolated_collections.users.insert_one(old_user.copy())
    await isolated_collections.payment_transactions.insert_one(old_transaction.copy())
    await server.create_checkout_session(
        CreateCheckoutSessionRequest(package_id="mab_s1_monthly", origin_url="https://mytonite86-coder.github.io/MAB-Path-Editor"),
        request=None,
        current_user={"user_id": str(ObjectId()), "email": "price-test@example.invalid"},
    )
    price = captured["line_items"][0]["price_data"]
    assert captured["mode"] == "subscription"
    assert price["unit_amount"] == 999
    assert price["currency"] == "usd"
    assert price["recurring"] == {"interval": "month", "interval_count": 1}
    assert captured["metadata"]["product_id"] == "mab_s1"
    assert captured["metadata"]["package_id"] == "mab_s1_monthly"
    assert "/MAB-Path-Editor/path?" in captured["success_url"]
    assert "checkout=success" in captured["success_url"]
    assert server.PREMIUM_PACKAGES["pathseal_monthly"]["amount"] == 9.99
    assert await isolated_collections.users.find_one({"_id": old_user["_id"]}) == old_user
    assert await isolated_collections.payment_transactions.find_one({"_id": old_transaction["_id"]}) == old_transaction
    new_transaction = await isolated_collections.payment_transactions.find_one({"session_id": "cs_test_price_only"})
    assert new_transaction["amount"] == 9.99


@pytest.mark.anyio
async def test_monthly_cancellation_removes_only_subscription_access(
    isolated_collections,
):
    user_id = ObjectId()
    await isolated_collections.users.insert_one(
        {
            "_id": user_id,
            "is_premium": False,
            "entitlements": [],
        }
    )
    await isolated_collections.payment_transactions.insert_one(
        {
            "user_id": str(user_id),
            "package_id": "mab_s1_monthly",
            "product_id": "mab_s1",
            "subscription_id": "sub_monthly_test",
            "access_active": False,
        }
    )

    active = {
        "id": "sub_monthly_test",
        "status": "active",
        "metadata": {
            "user_id": str(user_id),
            "package_id": "mab_s1_monthly",
            "product_id": "mab_s1",
        },
    }
    assert await server.sync_product_subscription(active)
    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["is_premium"] is True
    assert user["entitlements"] == [server.MAB_SUBSCRIPTION_ENTITLEMENT]

    canceled = {**active, "status": "canceled"}
    assert await server.sync_product_subscription(canceled)
    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["is_premium"] is False
    assert user["entitlements"] == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    "permanent_entitlement",
    [
        "mab_s1",
        "founder_lifetime",
        "complimentary_lifetime",
        "all_products_lifetime",
    ],
)
async def test_monthly_cancellation_preserves_permanent_access(
    isolated_collections,
    permanent_entitlement,
):
    user_id = ObjectId()
    await isolated_collections.users.insert_one(
        {
            "_id": user_id,
            "is_premium": True,
            "entitlements": [
                permanent_entitlement,
                server.MAB_SUBSCRIPTION_ENTITLEMENT,
            ],
        }
    )
    await isolated_collections.payment_transactions.insert_one(
        {
            "user_id": str(user_id),
            "package_id": "mab_s1_monthly",
            "product_id": "mab_s1",
            "subscription_id": "sub_protected_test",
            "access_active": True,
        }
    )

    canceled = {
        "id": "sub_protected_test",
        "status": "canceled",
        "metadata": {
            "user_id": str(user_id),
            "package_id": "mab_s1_monthly",
            "product_id": "mab_s1",
        },
    }
    assert await server.sync_product_subscription(canceled)
    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["is_premium"] is True
    assert user["entitlements"] == [permanent_entitlement]


@pytest.mark.anyio
async def test_real_stripe_test_checkout_is_monthly_and_999(
    isolated_collections,
):
    test_key = os.environ.get("STRIPE_TEST_API_KEY", "")
    if not test_key.startswith("sk_test_"):
        pytest.skip("STRIPE_TEST_API_KEY must be an explicit Stripe test key")

    monkeypatch_key = server.STRIPE_API_KEY
    server.STRIPE_API_KEY = test_key
    session = None
    try:
        response = await server.create_checkout_session(
            CreateCheckoutSessionRequest(
                package_id="mab_s1_monthly",
                origin_url="https://mytonite86-coder.github.io/MAB-Path-Editor",
            ),
            request=None,
            current_user={
                "user_id": str(ObjectId()),
                "email": "mab-s1-25-stripe-test@example.invalid",
            },
        )
        session = stripe.checkout.Session.retrieve(
            response.session_id,
            expand=["line_items.data.price"],
        )
        price = session.line_items.data[0].price
        assert session.mode == "subscription"
        assert price.unit_amount == 999
        assert price.currency == "usd"
        assert price.recurring.interval == "month"

        transaction = await isolated_collections.payment_transactions.find_one(
            {"session_id": response.session_id}
        )
        assert transaction["package_id"] == "mab_s1_monthly"
        assert transaction["billing_mode"] == "subscription"
        assert transaction["amount"] == 9.99
    finally:
        server.STRIPE_API_KEY = monkeypatch_key
        if session is not None and session.status == "open":
            stripe.checkout.Session.expire(session.id)
