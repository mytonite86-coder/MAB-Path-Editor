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
    monkeypatch.setattr(server, "shopify_fulfillments_collection",
                        database.shopify_fulfillments)
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

    def fake_send(email, order_id, codes, services, timezone):
        deliveries.append((email, order_id, codes, services, timezone))
        return "gmail-test-message"

    monkeypatch.setattr(server, "send_shopify_fulfillment_email", fake_send)

    async def scenario():
        order = make_order(line_items=[{
            "product_id": PRODUCT_ID, "variant_id": VARIANT_ID,
            "quantity": 2,
        }])
        first = await server.shopify_order_paid(make_request(order))
        second = await server.shopify_order_paid(make_request(order))
        records = await configured_server.activation_codes.find({}).to_list(None)
        assert first == {
            "status": "delivered",
            "delivery_complete": True,
            "mab_license_quantity": 2,
            "product_type": "mab_s1",
        }
        assert second == first
        assert len(records) == 2
        assert len(deliveries) == 1
        assert {entry["unit"] for entry in deliveries[0][2]} == {1, 2}
        assert deliveries[0][3] == []
        assert all(record["delivery_status"] == "delivered" for record in records)
        audit = await configured_server.shopify_fulfillments.find_one({})
        assert audit["send_status"] == "delivered"
        assert audit["sent_sections"] == ["mab_s1_activation"]
        assert audit["provider_message_id"] == "gmail-test-message"
        assert "MAB1-" not in json.dumps(first)
        assert "MAB1-" not in json.dumps(audit, default=str)

    run(scenario())


def test_failed_delivery_retries_same_license_without_reissuance(
        configured_server, monkeypatch):
    attempts = []

    def flaky_send(email, order_id, codes, services, timezone):
        attempts.append([c["activation_code"] for c in codes])
        if len(attempts) == 1:
            raise OSError("synthetic Gmail API failure")
        return "gmail-recovered-id"

    monkeypatch.setattr(server, "send_shopify_fulfillment_email", flaky_send)

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
        audit = await configured_server.shopify_fulfillments.find_one({})
        assert audit["send_attempts"] == 2
        assert audit["send_status"] == "delivered"

    run(scenario())


def test_duplicate_order_with_changed_email_requires_review(
        configured_server, monkeypatch):
    deliveries = []
    monkeypatch.setattr(
        server, "send_shopify_fulfillment_email",
        lambda email, *args: deliveries.append(email) or "gmail-id",
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


def test_ineligible_orders_fail_closed(configured_server, monkeypatch, order):
    monkeypatch.setattr(
        server, "send_shopify_fulfillment_email",
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
        server, "send_shopify_fulfillment_email",
        lambda *args: pytest.fail("delivery should not be attempted"),
    )

    async def scenario():
        with pytest.raises(HTTPException):
            await server.shopify_order_paid(webhook_request)
        assert await configured_server.activation_codes.count_documents({}) == 0

    run(scenario())


def test_refund_and_cancel_record_review_without_revocation(
        configured_server, monkeypatch):
    monkeypatch.setattr(server, "send_shopify_fulfillment_email",
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


def test_gmail_https_sender_and_mab_template(monkeypatch):
    import email
    from shopify_delivery import (
        compose_fulfillment_message, send_shopify_fulfillment_email,
    )

    class Response:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data

        def json(self):
            return self._data

    sent = []

    def post(url, **kwargs):
        sent.append((url, kwargs))
        if "oauth2.googleapis" in url:
            return Response(200, {"access_token": "test-access-token"})
        return Response(200, {"id": "gmail-sent-message-id"})

    monkeypatch.setenv("MAB_LICENSE_FROM_EMAIL", "business@example.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "local-client")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "local-secret")
    monkeypatch.setenv("GMAIL_OAUTH_REFRESH_TOKEN", "local-refresh")
    monkeypatch.setattr("shopify_delivery.requests.post", post)
    code = generate_activation_code()
    result = send_shopify_fulfillment_email(
        "buyer@example.com", "12345",
        [{"unit": 2, "activation_code": code}], [],
    )
    assert result == "gmail-sent-message-id"
    assert len(sent) == 2
    assert sent[1][0] == "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
    assert sent[1][1]["headers"]["Authorization"] == "Bearer test-access-token"
    import base64
    raw = sent[1][1]["json"]["raw"]
    msg = email.message_from_bytes(base64.urlsafe_b64decode(raw))
    body = msg.get_payload(decode=True).decode()
    assert "Shopify order: 12345" in body
    assert code in body
    assert "Submit Activation Code" in body
    assert "mab_s1" in body
    assert "SERVICE SCHEDULING" not in body
    assert "M.A.B. S2 is not included" in body


def test_service_only_and_mixed_section_isolation(configured_server, monkeypatch):
    from shopify_delivery import compose_fulfillment_message
    deliveries = []

    def send(email, order_id, codes, services, timezone):
        deliveries.append((codes, services))
        message = compose_fulfillment_message(
            "business@example.com", email, order_id, codes, services, timezone
        )
        return f"gmail-msg-{len(deliveries)}"

    monkeypatch.setattr(server, "send_shopify_fulfillment_email", send)
    service_item = {
        "product_id": 15444231258391,
        "variant_id": 67854811398423,
        "sku": "SK-SVC-QA-ANDROID",
        "title": "Android App QA Quick Test",
        "quantity": 1,
        "properties": [
            {"name": "Estimated duration", "value": "45 minutes"},
            {"name": "Desired date", "value": "2026-10-28"},
        ],
    }

    async def scenario():
        service_order = make_order(id=45678, line_items=[service_item])
        first = await server.shopify_order_paid(make_request(service_order))
        assert first["product_type"] == "service"
        assert first["mab_license_quantity"] == 0
        assert len(deliveries) == 1
        assert not deliveries[0][0]
        assert deliveries[0][1][0]["service_name"] == "Android App QA Quick Test"
        assert deliveries[0][1][0]["estimated_duration"] == "45 minutes"
        assert deliveries[0][1][0]["desired_date"] == "2026-10-28"
        assert await configured_server.activation_codes.count_documents({}) == 0
        duplicate = await server.shopify_order_paid(make_request(service_order))
        assert duplicate["delivery_complete"]
        assert len(deliveries) == 1
        service_message = compose_fulfillment_message(
            "business@example.com", "buyer@example.com", "45678",
            [], deliveries[0][1],
        ).get_content()
        assert "SERVICE SCHEDULING" in service_message
        assert "10 AM to 10 PM" in service_message
        assert "America/Denver" in service_message
        assert "ACTIVATION" not in service_message
        assert "MAB1-" not in service_message

        mixed_order = make_order(
            id=56789,
            line_items=[
                {"product_id": PRODUCT_ID, "variant_id": VARIANT_ID, "quantity": 1},
                service_item,
            ],
        )
        second = await server.shopify_order_paid(make_request(mixed_order))
        assert second["product_type"] == "mixed"
        assert len(deliveries) == 2
        code = deliveries[1][0][0]["activation_code"]
        assert validate_activation_code(code)
        assert len(deliveries[1][1]) == 1
        mixed_message = compose_fulfillment_message(
            "business@example.com", "buyer@example.com",
            "56789", deliveries[1][0], deliveries[1][1],
        ).get_content()
        assert "M.A.B. S1 ACTIVATION" in mixed_message
        assert "SERVICE SCHEDULING" in mixed_message
        assert mixed_message.index("M.A.B. S1 ACTIVATION") < mixed_message.index(
            "SERVICE SCHEDULING"
        )
        assert code in mixed_message
        audits = await configured_server.shopify_fulfillments.find(
            {}
        ).to_list(None)
        assert len(audits) == 2
        assert all(a["send_status"] == "delivered" for a in audits)
        assert {a["product_type"] for a in audits} == {"service", "mixed"}

    run(scenario())
