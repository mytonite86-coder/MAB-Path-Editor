
import asyncio
from types import SimpleNamespace

from activation_codes import (
    generate_activation_code,
    hash_activation_code,
    validate_activation_code,
    redeem_activation_code,
    get_pending_redemption,
    mark_activation_complete,
)


class FakeCollection:
    """In-memory simulation of MongoDB activation records."""

    def __init__(self, record):
        self.record = record.copy()
        self.lock = asyncio.Lock()

    def matches(self, query):
        for key, expected in query.items():
            actual = self.record.get(key)
            if isinstance(expected, dict) and "$in" in expected:
                if actual not in expected["$in"]:
                    return False
            elif actual != expected:
                return False
        return True

    async def find_one_and_update(self, query, update, **kwargs):
        async with self.lock:
            if not self.matches(query):
                return None
            self.record.update(update["$set"])
            return self.record.copy()

    async def find_one(self, query):
        return self.record.copy() if self.matches(query) else None

    async def update_one(self, query, update):
        if not self.matches(query):
            return SimpleNamespace(matched_count=0)
        self.record.update(update["$set"])
        return SimpleNamespace(matched_count=1)


def test_code_generation():
    code = generate_activation_code()
    assert validate_activation_code(code)
    assert not validate_activation_code("INVALID")
    assert len(code) == 37


def test_single_use_and_recovery():
    async def scenario():
        code = generate_activation_code()
        collection = FakeCollection({
            "code_hash": hash_activation_code(code),
            "product_id": "mab_s1",
            "status": "issued",
            "redeemed_by": None,
            "entitlement_status": "pending",
        })

        first = await redeem_activation_code(collection, code, "user_a")
        assert first is not None
        assert first["redeemed_by"] == "user_a"

        second = await redeem_activation_code(collection, code, "user_b")
        assert second is None

        recovery = await get_pending_redemption(
            collection, code, "user_a"
        )
        assert recovery is not None

        assert await get_pending_redemption(
            collection, code, "user_b"
        ) is None

        assert await mark_activation_complete(
            collection, hash_activation_code(code), "user_a"
        )

        completed = await get_pending_redemption(
            collection, code, "user_a"
        )
        assert completed["entitlement_status"] == "complete"

    asyncio.run(scenario())


def test_shopify_issuance_retry_recovers_same_code(monkeypatch):
    from cryptography.fernet import Fernet
    from activation_codes import issue_shopify_activation_code

    monkeypatch.setenv(
        "MAB_ACTIVATION_ENCRYPTION_KEY",
        Fernet.generate_key().decode(),
    )

    class FakeShopifyCollection:
        def __init__(self):
            self.records = []

        async def find_one(self, query):
            for record in self.records:
                if all(record.get(k) == v for k, v in query.items()):
                    return record.copy()
            return None

        async def insert_one(self, record):
            if any(
                r["shopify_license_key"] == record["shopify_license_key"]
                for r in self.records
            ):
                raise AssertionError("Duplicate license issued")
            self.records.append(record.copy())

    async def scenario():
        collection = FakeShopifyCollection()

        first = await issue_shopify_activation_code(
            collection, "skald-kreepy-productions.myshopify.com",
            "test-order-123",
        )
        second = await issue_shopify_activation_code(
            collection, "skald-kreepy-productions.myshopify.com",
            "test-order-123",
        )

        assert first["created"] is True
        assert second["created"] is False
        assert first["code"] == second["code"]
        assert len(collection.records) == 1

    asyncio.run(scenario())

