from bson import ObjectId
import pytest
from mongomock_motor import AsyncMongoMockClient

import server


@pytest.fixture
def isolated_collections(monkeypatch):
    client = AsyncMongoMockClient()
    database = client.svg_subscription_reconciliation_test
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


async def seed_subscription(database, selected_product_ids=None):
    user_id = ObjectId()
    selected_product_ids = selected_product_ids or []
    await database.users.insert_one(
        {
            "_id": user_id,
            "is_premium": False,
            "entitlements": list(selected_product_ids),
        }
    )
    result = await database.payment_transactions.insert_one(
        {
            "user_id": str(user_id),
            "package_id": "svg_micro_eco_selection",
            "product_id": "svg_micro_eco_selection",
            "subscription_id": "sub_svg_test",
            "selected_product_ids": list(selected_product_ids),
            "access_active": bool(selected_product_ids),
        }
    )
    return user_id, result.inserted_id


def subscription(user_id, status, products):
    return {
        "id": "sub_svg_test",
        "status": status,
        "metadata": {
            "user_id": str(user_id),
            "package_id": "svg_micro_eco_selection",
            "selected_product_ids": ",".join(products),
        },
    }


@pytest.mark.anyio
async def test_verified_active_bundle_grants_each_selected_tool(
    isolated_collections,
):
    user_id, _ = await seed_subscription(isolated_collections)

    assert await server.sync_product_subscription(
        subscription(
            user_id,
            "active",
            ["pathseal", "duplicate_geometry"],
        ),
        event_type="customer.subscription.updated",
    )

    user = await isolated_collections.users.find_one({"_id": user_id})
    assert set(user["entitlements"]) == {
        "pathseal",
        "duplicate_geometry",
    }


@pytest.mark.anyio
async def test_downgrade_revokes_only_removed_tool(isolated_collections):
    user_id, _ = await seed_subscription(
        isolated_collections,
        ["pathseal", "duplicate_geometry"],
    )

    assert await server.sync_product_subscription(
        subscription(user_id, "active", ["duplicate_geometry"])
    )

    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["entitlements"] == ["duplicate_geometry"]


@pytest.mark.anyio
async def test_cancellation_preserves_lifetime_access(isolated_collections):
    user_id, _ = await seed_subscription(
        isolated_collections,
        ["pathseal", "duplicate_geometry"],
    )
    await isolated_collections.users.update_one(
        {"_id": user_id},
        {"$addToSet": {"entitlements": "all_products_lifetime"}},
    )

    assert await server.sync_product_subscription(
        subscription(
            user_id,
            "canceled",
            ["pathseal", "duplicate_geometry"],
        )
    )

    user = await isolated_collections.users.find_one({"_id": user_id})
    assert set(user["entitlements"]) == {
        "pathseal",
        "duplicate_geometry",
        "all_products_lifetime",
    }


@pytest.mark.anyio
async def test_uncertain_status_and_bad_metadata_fail_closed(
    isolated_collections,
):
    user_id, transaction_id = await seed_subscription(
        isolated_collections,
        ["pathseal"],
    )

    assert await server.sync_product_subscription(
        subscription(
            user_id,
            "incomplete",
            ["pathseal", "duplicate_geometry"],
        )
    )
    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["entitlements"] == ["pathseal"]

    malformed = subscription(user_id, "active", ["unknown_product"])
    assert not await server.sync_product_subscription(malformed)
    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["entitlements"] == ["pathseal"]
    transaction = await isolated_collections.payment_transactions.find_one(
        {"_id": transaction_id}
    )
    assert transaction["access_active"] is True
    assert transaction["selected_product_ids"] == [
        "pathseal",
        "duplicate_geometry",
    ]


@pytest.mark.anyio
async def test_duplicate_delivery_is_idempotent(isolated_collections):
    user_id, _ = await seed_subscription(isolated_collections)
    event = subscription(user_id, "active", ["duplicate_geometry"])

    assert await server.sync_product_subscription(event)
    assert await server.sync_product_subscription(event)

    user = await isolated_collections.users.find_one({"_id": user_id})
    assert user["entitlements"] == ["duplicate_geometry"]


@pytest.mark.anyio
async def test_other_active_bundle_prevents_shared_tool_revocation(
    isolated_collections,
):
    user_id, _ = await seed_subscription(
        isolated_collections,
        ["pathseal", "duplicate_geometry"],
    )
    await isolated_collections.payment_transactions.insert_one(
        {
            "user_id": str(user_id),
            "package_id": "svg_micro_eco_selection",
            "product_id": "svg_micro_eco_selection",
            "subscription_id": "sub_svg_other",
            "selected_product_ids": ["pathseal"],
            "access_active": True,
        }
    )

    assert await server.sync_product_subscription(
        subscription(user_id, "active", ["duplicate_geometry"])
    )

    user = await isolated_collections.users.find_one({"_id": user_id})
    assert set(user["entitlements"]) == {
        "pathseal",
        "duplicate_geometry",
    }
