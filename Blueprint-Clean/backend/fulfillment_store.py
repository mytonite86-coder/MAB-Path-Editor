"""MongoDB outbox for paid-order email fulfillment.

No activation code is ever persisted here. License secrets remain exclusively
in activation_codes, encrypted and bound to a Shopify order + license unit.
"""
from datetime import datetime, timedelta, timezone
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

CLAIM_TIMEOUT = timedelta(minutes=10)


def _key(shop_domain, order_id):
    return {"shop_domain": shop_domain.strip().lower(), "order_id": str(order_id)}


async def ensure_fulfillment_indexes(collection):
    await collection.create_index(
        [("shop_domain", 1), ("order_id", 1)],
        name="unique_shopify_fulfillment_order",
        unique=True,
    )


async def prepare_fulfillment(collection, shop_domain, order_id, email, route):
    """Create the immutable order snapshot or recover one for a retry."""
    identity = _key(shop_domain, order_id)
    doc = {
        **identity,
        "customer_email": email,
        "product_type": route["product_type"],
        "mab_license_quantity": route["mab_license_quantity"],
        "services": route["services"],
        "timezone": route["timezone"],
        "send_status": "pending",
        "send_attempts": 0,
        "sent_sections": [],
        "created_at": datetime.now(timezone.utc),
    }
    # Atomic upsert makes repeated sequential deliveries idempotent. The
    # compound unique index also protects against concurrent first deliveries.
    try:
        await collection.update_one(
            identity, {"$setOnInsert": doc}, upsert=True
        )
    except DuplicateKeyError:
        # Another webhook inserted the same order in parallel.
        pass
    existing = await collection.find_one(identity)
    if existing is None:
        raise RuntimeError("Fulfillment record unavailable.")
    for field in (
        "customer_email", "product_type", "mab_license_quantity",
        "services", "timezone",
    ):
        if existing.get(field) != doc.get(field):
            raise RuntimeError(
                "Shopify order fulfillment changed. Manual review required."
            )
    return existing


async def claim_fulfillment(collection, shop_domain, order_id):
    now = datetime.now(timezone.utc)
    key = _key(shop_domain, order_id)
    return await collection.find_one_and_update(
        {
            **key,
            "$or": [
                {"send_status": {"$in": ["pending", "failed"]}},
                {
                    "send_status": "sending",
                    "claimed_at": {"$lt": now - CLAIM_TIMEOUT},
                },
            ],
        },
        {
            "$set": {"send_status": "sending", "claimed_at": now},
            "$unset": {"send_last_error": ""},
            "$inc": {"send_attempts": 1},
        },
        return_document=ReturnDocument.AFTER,
    )


async def mark_fulfillment_sent(
    collection, shop_domain, order_id, provider_message_id, sections,
):
    result = await collection.update_one(
        {**_key(shop_domain, order_id), "send_status": "sending"},
        {
            "$set": {
                "send_status": "delivered",
                "provider_message_id": provider_message_id,
                "sent_sections": sections,
                "sent_at": datetime.now(timezone.utc),
            },
            "$unset": {"claimed_at": "", "send_last_error": ""},
        },
    )
    return result.matched_count == 1


async def mark_fulfillment_failed(
    collection, shop_domain, order_id, error_type="delivery_failed",
):
    result = await collection.update_one(
        {**_key(shop_domain, order_id), "send_status": "sending"},
        {
            "$set": {
                "send_status": "failed",
                "send_last_error": error_type,
                "failed_at": datetime.now(timezone.utc),
            },
            "$unset": {"claimed_at": ""},
        },
    )
    return result.matched_count == 1


async def get_fulfillment(collection, shop_domain, order_id):
    return await collection.find_one(_key(shop_domain, order_id))
