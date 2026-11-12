"""Isolated Shopify SVG lifetime acceptance, no external charges or emails."""
import asyncio
import base64
import hashlib
import hmac
import json
import os
from bson import ObjectId
from cryptography.fernet import Fernet
from fastapi import Request
from mongomock_motor import AsyncMongoMockClient
import pytest

os.environ.setdefault("JWT_SECRET", "local-test-jwt-secret")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "svg_shopify_isolated")
import server
from svg_shopify import SVG_SHOPIFY_PRODUCTS, svg_order_licenses

SHOP = "vd1k2v-ew.myshopify.com"
SECRET = "isolated-shopify-signature"

def req(order, topic="orders/paid", secret=SECRET):
    raw = json.dumps(order, separators=(",", ":")).encode()
    signature = base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest()).decode()
    sent = False
    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": raw, "more_body": False}
        return {"type": "http.disconnect"}
    return Request({
        "type": "http", "method": "POST", "path": "/api/shopify/webhooks/orders-paid",
        "headers": [(b"x-shopify-hmac-sha256", signature.encode()),
                    (b"x-shopify-topic", topic.encode()),
                    (b"x-shopify-shop-domain", SHOP.encode())],
    }, receive)

def order(product, variant, quantity=1):
    return {
        "id": 987654321, "email": "buyer@example.com",
        "financial_status": "paid", "cancelled_at": None, "refunds": [],
        "line_items": [{"product_id": product, "variant_id": variant, "quantity": quantity}],
    }

@pytest.fixture
def sandbox(monkeypatch):
    db = AsyncMongoMockClient().svg_shopify_tests
    for col in ("activation_codes", "shopify_order_states", "shopify_fulfillments", "users"):
        monkeypatch.setattr(server, col + "_collection", getattr(db, col))
    monkeypatch.setenv("SHOPIFY_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("SHOPIFY_SHOP_DOMAIN", SHOP)
    monkeypatch.setenv("MAB_ACTIVATION_ENCRYPTION_KEY", Fernet.generate_key().decode())
    emails = []
    def fake_mail(recipient, order_id, mab_codes, services, timezone, svg_codes=None):
        emails.append({"recipient": recipient, "svg": svg_codes or [], "mab": mab_codes})
        return "msg_isolated"
    monkeypatch.setattr(server, "send_shopify_fulfillment_email", fake_mail)
    return db, emails

@pytest.mark.parametrize("product_variant", list(SVG_SHOPIFY_PRODUCTS))
def test_catalog_exact_matching(product_variant):
    product, variant = product_variant
    found = svg_order_licenses(order(product, variant))
    assert found[0]["entitlements"] == SVG_SHOPIFY_PRODUCTS[product_variant][1]
    assert svg_order_licenses(order(product, "unmatched")) == []
    assert svg_order_licenses(order("unmatched", variant)) == []

@pytest.mark.parametrize("product_variant", list(SVG_SHOPIFY_PRODUCTS))
def test_paid_order_issues_correct_code_and_grant(sandbox, product_variant):
    db, emails = sandbox
    async def check():
        await db.activation_codes.create_index("code_hash", unique=True)
        await db.activation_codes.create_index("shopify_license_key", unique=True)
        product, variant = product_variant
        user_id = str(ObjectId())
        await db.users.insert_one({"_id": ObjectId(user_id), "entitlements": [],
                                   "svg_lifetime_entitlements": [], "is_premium": False})
        data = order(product, variant)
        response = await server.shopify_order_paid(req(data))
        assert response["delivery_complete"] is True
        assert len(emails) == 1 and len(emails[0]["svg"]) == 1
        code = emails[0]["svg"][0]["activation_code"]
        assert code.startswith("SVG1-") and len(code) == 37
        assert (await db.activation_codes.count_documents({})) == 1
        again = await server.shopify_order_paid(req(data))
        assert again["delivery_complete"] is True
        assert len(emails) == 1, "duplicate webhook must not resend"
        redeemed = await server.activate_svg_lifetime(server.RedeemActivationRequest(code=code), {"user_id": user_id})
        expected = SVG_SHOPIFY_PRODUCTS[product_variant][1]
        assert redeemed["entitlements"] == expected
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        assert set(user["entitlements"]) == set(expected)
        assert set(user["svg_lifetime_entitlements"]) == set(expected)
        assert user["is_premium"] is False, "SVG never grants MAB premium"
        repeated = await server.activate_svg_lifetime(server.RedeemActivationRequest(code=code), {"user_id": user_id})
        assert repeated["success"] is True
        attacker = str(ObjectId())
        await db.users.insert_one({"_id": ObjectId(attacker), "entitlements": []})
        with pytest.raises(Exception):
            await server.activate_svg_lifetime(server.RedeemActivationRequest(code=code), {"user_id": attacker})
    asyncio.run(check())

def test_unpaid_and_wrong_signature_never_issue(sandbox):
    db, emails = sandbox
    async def check():
        data=order("15476021592343","68167232127255")
        data["financial_status"]="pending"
        res=await server.shopify_order_paid(req(data))
        assert res["status"]=="ignored"
        data["financial_status"]="paid"
        with pytest.raises(Exception):
            await server.shopify_order_paid(req(data, secret="wrong"))
        assert await db.activation_codes.count_documents({}) == 0
        assert emails==[]
    asyncio.run(check())

def test_refund_hold_blocks_unredeemed_code(sandbox):
    db, emails = sandbox
    async def check():
        item=("15476021592343","68167232127255")
        await server.shopify_order_paid(req(order(*item)))
        code=emails[0]["svg"][0]["activation_code"]
        refund={"order_id":987654321,"refund_line_items":[{"line_item":{"product_id":item[0],"variant_id":item[1]}}]}
        result=await server.shopify_refund_created(req(refund,topic="refunds/create"))
        assert result["status"]=="recorded"
        uid=str(ObjectId())
        await db.users.insert_one({"_id":ObjectId(uid),"entitlements":[]})
        with pytest.raises(Exception):
            await server.activate_svg_lifetime(server.RedeemActivationRequest(code=code),{"user_id":uid})
        user=await db.users.find_one({"_id":ObjectId(uid)})
        assert not user["entitlements"]
    asyncio.run(check())

def test_quantity_two_creates_two_distinct_codes(sandbox):
    db, emails = sandbox
    async def check():
        await server.shopify_order_paid(req(order("15476020576535", "68167230914839", quantity=2)))
        codes=[x["activation_code"] for x in emails[0]["svg"]]
        assert len(set(codes))==2
        assert await db.activation_codes.count_documents({})==2
    asyncio.run(check())
