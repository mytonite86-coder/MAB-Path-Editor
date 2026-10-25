import asyncio
import base64
import hashlib
import hmac
import json
import os
from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException, Request
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("JWT_SECRET", "local-test-jwt-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "mab_local_test")

import server  # noqa: E402
from activation_codes import (  # noqa: E402
    decrypt_delivery_code,
    generate_activation_code,
    get_pending_redemption,
    hash_activation_code,
    issue_shopify_activation_code,
    mark_activation_complete,
    redeem_activation_code,
    validate_activation_code,
)
from shopify_delivery import send_shopify_activation_email  # noqa: E402


SHOP_DOMAIN = "vd1k2v-ew.myshopify.com"
PRODUCT_ID = 15428412571927
VARIANT_ID = 67773605544215
WEBHOOK_SECRET = "local-shopify-test-secret"


def run(coro):
    return asyncio.run(coro)


def make_order(**overrides):
    order = {
        "id": 12345,
        "email": "buyer@example.com",
        "financial_status": "paid",
        "cancelled_at": None,
        "refunds": [],
        "line_items": [{
            "product_id": PRODUCT_ID,
            "variant_id": VARIANT_ID,
            "quantity": 1,
        }],
    }
    order.update(overrides)
    return order


def make_request(payload, topic="orders/paid", shop=SHOP_DOMAIN,
                 secret=WEBHOOK_SECRET, signature=None):
    body = json.dumps(payload).encode()
    if signature is None:
        signature = base64.b64encode(
            hmac.new(secret.encode(), body, hashlib.sha256).digest()
        ).decode()
    headers = [
        (b"x-shopify-hmac-sha256", signature.encode()),
        (b"x-shopify-topic", topic.encode()),
        (b"x-shopify-shop-domain", shop.encode()),
    ]
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/shopify/webhooks",
        "headers": headers,
    }, receive)


@pytest.fixture
def configured_server(monkeypatch):
    database = AsyncMongoMockClient()["mab_shopify_test"]
    monkeypatch.setattr(server, "activation_codes_collection",
                        database.activation_codes)
    monkeypatch.setattr(server, "shopify_order_states_collection",
                        database.shopify_order_states)
    monkeypatch.setattr(server, "users_collection", database.users)
    monkeypatch.setenv("SHOPIFY_WEBHOOK_SECRET", WEBHOOK_SECRET)
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", SHOP_DOMAIN)
    monkeypatch.setenv("MAB_ACTIVATION_ENCRYPTION_KEY",
                       Fernet.generate_key().decode())
    return database


def test_code_generation():
    code = generate_activation_code()
    assert validate_activation_code(code)
    assert not validate_activation_code("INVALID")
    assert len(code) == 37


def test_single_use_and_recovery(monkeypatch):
    async def scenario():
        database = AsyncMongoMockClient()["redemption"]
        code = generate_activation_code()
        await database.activation_codes.insert_one({
            "code_hash": hash_activation_code(code),
            "product_id": "mab_s1",
            "status": "issued",
            "redeemed_by": None,
            "entitlement_status": "pending",
        })
        first = await redeem_activation_code(
            database.activation_codes, code, "user_a"
        )
        assert first["redeemed_by"] == "user_a"
        assert await redeem_activation_code(
            database.activation_codes, code, "user_b"
        ) is None
        assert await get_pending_redemption(
            database.activation_codes, code, "user_a"
        ) is not None
        assert await mark_activation_complete(
            database.activation_codes, hash_activation_code(code), "user_a"
        )
        completed = await get_pending_redemption(
            database.activation_codes, code, "user_a"
        )
        assert completed["entitlement_status"] == "complete"

    run(scenario())


def test_concurrent_shopify_issuance_reuses_encrypted_code(monkeypatch):
    async def scenario():
        database = AsyncMongoMockClient()["issuance"]
        key = Fernet.generate_key().decode()
        monkeypatch.setenv("MAB_ACTIVATION_ENCRYPTION_KEY", key)
        first, second = await asyncio.gather(
            issue_shopify_activation_code(
                database.activation_codes, SHOP_DOMAIN, "order-1", 1,
                "buyer@example.com",
            ),
            issue_shopify_activation_code(
                database.activation_codes, SHOP_DOMAIN, "order-1", 1,
                "buyer@example.com",
            ),
        )
        assert first["code"] == second["code"]
        assert {first["created"], second["created"]} == {True, False}
        records = await database.activation_codes.find({}).to_list(None)
        assert len(records) == 1
        assert records[0]["code_hash"] != first["code"]
        assert records[0]["encrypted_delivery_code"] != first["code"]
        assert decrypt_delivery_code(
            records[0]["encrypted_delivery_code"]
        ) == first["code"]

    run(scenario())


def test_paid_webhook_quantity_and_duplicate_are_delivery_safe(
        configured_server, monkeypatch):
    deliveries = []

    def fake_send(email, code, order_id, unit):
        deliveries.append((email, code, order_id, unit))

    monkeypatch.setattr(server, "send_shopify_activation_email", fake_send)

    async def scenario():
        order = make_order(line_items=[{
            "product_id": PRODUCT_ID,
            "variant_id": VARIANT_ID,
            "quantity": 2,
        }])
        first = await server.shopify_order_paid(make_request(order))
        second = await server.shopify_order_paid(make_request(order))
        records = await configured_server.activation_codes.find({}).to_list(None)
        assert first == {
            "status": "delivered",
            "delivery_complete": True,
            "mab_license_quantity": 2,
        }
        assert second == first
        assert len(records) == 2
        assert len(deliveries) == 2
        assert {delivery[3] for delivery in deliveries} == {1, 2}
        assert all(record["delivery_status"] == "delivered" for record in records)
        assert "MAB1-" not in json.dumps(first)

    run(scenario())


def test_failed_delivery_retries_same_license_without_reissuance(
        configured_server, monkeypatch):
    attempts = []

    def flaky_send(email, code, order_id, unit):
        attempts.append(code)
        if len(attempts) == 1:
            raise OSError("synthetic SMTP failure")

    monkeypatch.setattr(server, "send_shopify_activation_email", flaky_send)

    async def scenario():
        order = make_order()
        with pytest.raises(HTTPException) as error:
            await server.shopify_order_paid(make_request(order))
        assert error.value.status_code == 503
        result = await server.shopify_order_paid(make_request(order))
        records = await configured_server.activation_codes.find({}).to_list(None)
        assert result["delivery_complete"] is True
        assert len(records) == 1
        assert attempts[0] == attempts[1]
        assert records[0]["delivery_attempts"] == 2
        assert records[0]["delivery_status"] == "delivered"

    run(scenario())


def test_duplicate_order_with_changed_email_requires_review(
        configured_server, monkeypatch):
    deliveries = []
    monkeypatch.setattr(
        server,
        "send_shopify_activation_email",
        lambda email, *args: deliveries.append(email),
    )

    async def scenario():
        await server.shopify_order_paid(make_request(make_order()))
        with pytest.raises(RuntimeError, match="email changed"):
            await server.shopify_order_paid(
                make_request(make_order(email="different@example.com"))
            )
        assert deliveries == ["buyer@example.com"]
        assert await configured_server.activation_codes.count_documents({}) == 1

    run(scenario())


@pytest.mark.parametrize("order", [
    make_order(financial_status="pending"),
    make_order(cancelled_at="2026-10-24T00:00:00Z"),
    make_order(refunds=[{"id": 99}]),
    make_order(line_items=[]),
    make_order(line_items=[{
        "product_id": 999,
        "variant_id": VARIANT_ID,
        "quantity": 1,
    }]),
])
def test_ineligible_orders_fail_closed(configured_server, monkeypatch, order):
    monkeypatch.setattr(
        server, "send_shopify_activation_email",
        lambda *args: pytest.fail("delivery should not be attempted"),
    )

    async def scenario():
        result = await server.shopify_order_paid(make_request(order))
        assert result["status"] == "ignored"
        assert await configured_server.activation_codes.count_documents({}) == 0

    run(scenario())


@pytest.mark.parametrize("webhook_request", [
    make_request(make_order(), signature="invalid"),
    make_request(make_order(), topic="orders/create"),
    make_request(make_order(), shop="untrusted.myshopify.com"),
    make_request(make_order(email="not-an-email")),
])
def test_webhook_identity_and_email_validation_fail_closed(
        configured_server, monkeypatch, webhook_request):
    monkeypatch.setattr(
        server, "send_shopify_activation_email",
        lambda *args: pytest.fail("delivery should not be attempted"),
    )

    async def scenario():
        with pytest.raises(HTTPException):
            await server.shopify_order_paid(webhook_request)
        assert await configured_server.activation_codes.count_documents({}) == 0

    run(scenario())


def test_refund_and_cancel_record_review_without_revocation(
        configured_server, monkeypatch):
    monkeypatch.setattr(server, "send_shopify_activation_email",
                        lambda *args: None)

    async def scenario():
        order = make_order()
        await server.shopify_order_paid(make_request(order))
        refund = {
            "id": 55,
            "order_id": order["id"],
            "refund_line_items": [{
                "line_item": {
                    "product_id": PRODUCT_ID,
                    "variant_id": VARIANT_ID,
                }
            }],
        }
        refund_result = await server.shopify_refund_created(
            make_request(refund, topic="refunds/create")
        )
        assert refund_result["status"] == "recorded"
        record = await configured_server.activation_codes.find_one({})
        assert record["status"] == "issued"
        assert record["commerce_review_required"] is True
        retry = await server.shopify_order_paid(make_request(order))
        assert retry == {
            "status": "ignored",
            "reason": "commerce_review_required",
        }

        cancelled = make_order(id=54321)
        cancel_result = await server.shopify_order_cancelled(
            make_request(cancelled, topic="orders/cancelled")
        )
        assert cancel_result["status"] == "recorded"

    run(scenario())


def test_activation_endpoint_grants_mab_s1_once(configured_server, monkeypatch):
    grants = []
    user_id = "507f1f77bcf86cd799439011"

    async def grant(granted_user_id, product_id):
        grants.append((granted_user_id, product_id))
        await configured_server.users.update_one(
            {"_id": server.ObjectId(granted_user_id)},
            {"$addToSet": {"entitlements": product_id}},
        )

    monkeypatch.setattr(server, "grant_product_entitlement", grant)

    async def scenario():
        await configured_server.users.insert_one({
            "_id": server.ObjectId(user_id),
            "entitlements": [],
        })
        code = generate_activation_code()
        await configured_server.activation_codes.insert_one({
            "code_hash": hash_activation_code(code),
            "product_id": "mab_s1",
            "status": "issued",
            "redeemed_by": None,
            "entitlement_status": "pending",
        })
        result = await server.activate_premium(
            server.RedeemActivationRequest(code=code),
            current_user={"user_id": user_id},
        )
        assert result["success"] is True
        assert grants == [(user_id, "mab_s1")]
        second = await server.activate_premium(
            server.RedeemActivationRequest(code=code),
            current_user={"user_id": user_id},
        )
        assert second["success"] is True
        assert "already active" in second["message"]
        assert grants == [(user_id, "mab_s1")]

    run(scenario())


def test_smtp_configuration_uses_environment_and_message_is_bounded(monkeypatch):
    sent = []

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            sent.append(("connect", host, port, timeout))

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def starttls(self, context=None):
            sent.append(("tls", context is not None))

        def login(self, username, password):
            sent.append(("login", username, password))

        def send_message(self, message):
            sent.append(("message", message))

    monkeypatch.setenv("MAB_LICENSE_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("MAB_LICENSE_SMTP_PORT", "587")
    monkeypatch.setenv("MAB_LICENSE_SMTP_USERNAME", "mailer")
    monkeypatch.setenv("MAB_LICENSE_SMTP_PASSWORD", "secret")
    monkeypatch.setenv("MAB_LICENSE_FROM_EMAIL", "licenses@example.com")

    with patch("shopify_delivery.smtplib.SMTP", FakeSmtp):
        send_shopify_activation_email(
            "buyer@example.com", "MAB1-TEST-TEST-TEST-TEST-TEST-TEST",
            "12345", 2,
        )

    message = [item[1] for item in sent if item[0] == "message"][0]
    body = message.get_content()
    assert message["To"] == "buyer@example.com"
    assert "Shopify order: 12345" in body
    assert "license unit: 2" in body
    assert "MAB1-TEST-TEST-TEST-TEST-TEST-TEST" in body
    assert "does not include automatic M.A.B. S2 access" in body
