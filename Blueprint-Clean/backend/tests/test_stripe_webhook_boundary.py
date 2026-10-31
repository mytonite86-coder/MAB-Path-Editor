import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock

from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient
import pytest

import server


class FakeRequest:
    def __init__(self, body=b"{}", signature=None):
        self._body = body
        self.headers = {}
        if signature is not None:
            self.headers["Stripe-Signature"] = signature

    async def body(self):
        return self._body


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_webhook_rejects_missing_secret_before_processing(monkeypatch):
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    process_checkout = AsyncMock()
    sync_subscription = AsyncMock()
    monkeypatch.setattr(server, "process_checkout_session", process_checkout)
    monkeypatch.setattr(server, "sync_product_subscription", sync_subscription)

    with pytest.raises(HTTPException) as exc:
        await server.stripe_webhook(FakeRequest(signature="test_signature"))

    assert exc.value.status_code == 500
    process_checkout.assert_not_awaited()
    sync_subscription.assert_not_awaited()


@pytest.mark.anyio
async def test_webhook_rejects_missing_signature_before_processing(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_local_test_only")
    process_checkout = AsyncMock()
    sync_subscription = AsyncMock()
    monkeypatch.setattr(server, "process_checkout_session", process_checkout)
    monkeypatch.setattr(server, "sync_product_subscription", sync_subscription)

    with pytest.raises(HTTPException) as exc:
        await server.stripe_webhook(FakeRequest())

    assert exc.value.status_code == 400
    assert exc.value.detail == "Missing Stripe-Signature header"
    process_checkout.assert_not_awaited()
    sync_subscription.assert_not_awaited()


@pytest.mark.anyio
async def test_invalid_signature_never_reaches_business_handlers(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_local_test_only")
    process_checkout = AsyncMock()
    sync_subscription = AsyncMock()
    monkeypatch.setattr(server, "process_checkout_session", process_checkout)
    monkeypatch.setattr(server, "sync_product_subscription", sync_subscription)

    def reject_signature(**_kwargs):
        raise server.stripe.error.SignatureVerificationError(
            "invalid local signature",
            "test_signature",
        )

    monkeypatch.setattr(
        server.stripe.Webhook,
        "construct_event",
        reject_signature,
    )

    with pytest.raises(HTTPException) as exc:
        await server.stripe_webhook(FakeRequest(signature="test_signature"))

    assert exc.value.status_code == 400
    assert exc.value.detail == "Invalid Stripe webhook signature"
    process_checkout.assert_not_awaited()
    sync_subscription.assert_not_awaited()


@pytest.mark.anyio
async def test_verified_subscription_event_routes_exact_object(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_local_test_only")
    stripe_object = {
        "id": "sub_local_test",
        "status": "active",
        "metadata": {
            "package_id": "svg_micro_eco_selection",
            "selected_product_ids": "pathseal,duplicate_geometry",
        },
    }
    event = {
        "type": "customer.subscription.updated",
        "data": {"object": stripe_object},
    }
    captured = {}

    def verify_event(**kwargs):
        captured.update(kwargs)
        return event

    monkeypatch.setattr(
        server.stripe.Webhook,
        "construct_event",
        verify_event,
    )
    process_checkout = AsyncMock()
    sync_subscription = AsyncMock(return_value=True)
    monkeypatch.setattr(server, "process_checkout_session", process_checkout)
    monkeypatch.setattr(server, "sync_product_subscription", sync_subscription)

    result = await server.stripe_webhook(
        FakeRequest(body=b'{"local":"payload"}', signature="test_signature")
    )

    assert result == {"received": True}
    assert captured == {
        "payload": b'{"local":"payload"}',
        "sig_header": "test_signature",
        "secret": "whsec_local_test_only",
    }
    sync_subscription.assert_awaited_once_with(
        stripe_object,
        event_type="customer.subscription.updated",
    )
    process_checkout.assert_not_awaited()


@pytest.mark.anyio
async def test_verified_checkout_event_routes_exact_object(monkeypatch):
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_local_test_only")
    stripe_object = {
        "id": "cs_local_test",
        "metadata": {"package_id": "svg_micro_eco_selection"},
    }
    event = {
        "type": "checkout.session.completed",
        "data": {"object": stripe_object},
    }
    monkeypatch.setattr(
        server.stripe.Webhook,
        "construct_event",
        lambda **_kwargs: event,
    )
    process_checkout = AsyncMock(return_value=True)
    sync_subscription = AsyncMock()
    monkeypatch.setattr(server, "process_checkout_session", process_checkout)
    monkeypatch.setattr(server, "sync_product_subscription", sync_subscription)

    assert await server.stripe_webhook(
        FakeRequest(signature="test_signature")
    ) == {"received": True}

    process_checkout.assert_awaited_once_with(
        stripe_object,
        event_type="checkout.session.completed",
    )
    sync_subscription.assert_not_awaited()


@pytest.mark.anyio
async def test_real_signature_reaches_isolated_entitlement_reconciliation(
    monkeypatch,
):
    secret = "whsec_local_real_signature_test"
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    client = AsyncMongoMockClient()
    database = client.real_signature_webhook_test
    monkeypatch.setattr(server, "users_collection", database.users)
    monkeypatch.setattr(
        server,
        "payment_transactions_collection",
        database.payment_transactions,
    )
    user_id = ObjectId()
    await database.users.insert_one(
        {
            "_id": user_id,
            "is_premium": False,
            "entitlements": [],
        }
    )
    await database.payment_transactions.insert_one(
        {
            "user_id": str(user_id),
            "package_id": "svg_micro_eco_selection",
            "product_id": "svg_micro_eco_selection",
            "subscription_id": "sub_real_signature_test",
            "selected_product_ids": [],
            "access_active": False,
        }
    )
    event = {
        "id": "evt_real_signature_test",
        "object": "event",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": "sub_real_signature_test",
                "object": "subscription",
                "status": "active",
                "metadata": {
                    "user_id": str(user_id),
                    "package_id": "svg_micro_eco_selection",
                    "selected_product_ids": (
                        "pathseal,duplicate_geometry"
                    ),
                },
            }
        },
    }
    payload = json.dumps(event, separators=(",", ":")).encode()
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    signature = hmac.new(
        secret.encode(),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    result = await server.stripe_webhook(
        FakeRequest(
            body=payload,
            signature=f"t={timestamp},v1={signature}",
        )
    )

    assert result == {"received": True}
    user = await database.users.find_one({"_id": user_id})
    assert set(user["entitlements"]) == {
        "pathseal",
        "duplicate_geometry",
    }
    transaction = await database.payment_transactions.find_one(
        {"subscription_id": "sub_real_signature_test"}
    )
    assert transaction["access_active"] is True
    assert transaction["last_event_type"] == (
        "customer.subscription.updated"
    )
    client.close()
