from types import SimpleNamespace

from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient
import pytest

import server
from models import CreateSvgSubscriptionCheckoutRequest


@pytest.fixture
def isolated_checkout(monkeypatch):
    client = AsyncMongoMockClient()
    database = client.svg_checkout_test
    monkeypatch.setattr(
        server,
        "payment_transactions_collection",
        database.payment_transactions,
    )
    monkeypatch.setattr(server, "users_collection", database.users)
    yield database
    client.close()


@pytest.fixture
def anyio_backend():
    return "asyncio"


def checkout_request(products=None):
    return CreateSvgSubscriptionCheckoutRequest(
        selected_product_ids=products or ["duplicate_geometry"],
        origin_url=(
            "https://mytonite86-coder.github.io/svg-path-closer/"
            "duplicate-geometry.html"
        ),
    )


def current_user():
    return {
        "user_id": str(ObjectId()),
        "email": "customer@example.test",
    }


@pytest.mark.anyio
async def test_checkout_switch_is_off_by_default(
    isolated_checkout,
    monkeypatch,
):
    monkeypatch.delenv("SVG_SUBSCRIPTION_CHECKOUT_ENABLED", raising=False)

    with pytest.raises(HTTPException) as exc:
        await server.create_svg_subscription_checkout_session(
            checkout_request(),
            request=None,
            current_user=current_user(),
        )

    assert exc.value.status_code == 503
    assert await isolated_checkout.payment_transactions.count_documents({}) == 0


@pytest.mark.anyio
async def test_enabled_fake_checkout_builds_bounded_session_and_status_record(
    isolated_checkout,
    monkeypatch,
):
    monkeypatch.setenv("SVG_SUBSCRIPTION_CHECKOUT_ENABLED", "1")
    monkeypatch.setenv(
        "STRIPE_PRICE_DUPLICATE_GEOMETRY_LIFETIME",
        "price_duplicate_test",
    )
    monkeypatch.setenv(
        "STRIPE_SVG_INTEGRATION_IDENTIFIER",
        "svg_micro_eco_test",
    )
    captured = {}

    def fake_create(parameters):
        captured.update(parameters)
        return SimpleNamespace(
            id="cs_test_svg_disabled_connection",
            url="https://checkout.stripe.test/session",
        )

    fake_sessions = SimpleNamespace(create=fake_create)
    monkeypatch.setattr(
        server,
        "STRIPE_API_KEY",
        "fixture_key",
    )
    monkeypatch.setattr(
        server.stripe,
        "StripeClient",
        lambda *args: SimpleNamespace(
            v1=SimpleNamespace(
                checkout=SimpleNamespace(sessions=fake_sessions)
            )
        ),
    )
    user = current_user()
    response = await server.create_svg_subscription_checkout_session(
        checkout_request(),
        request=None,
        current_user=user,
    )

    assert response.session_id == "cs_test_svg_disabled_connection"
    assert captured["mode"] == "payment"
    assert captured["line_items"] == [
        {"price": "price_duplicate_test", "quantity": 1}
    ]
    assert captured["metadata"]["selected_product_ids"] == (
        "duplicate_geometry"
    )
    assert "payment_method_types" not in captured
    assert "automatic_tax" not in captured
    transaction = await isolated_checkout.payment_transactions.find_one(
        {"session_id": response.session_id}
    )
    assert transaction["user_id"] == user["user_id"]
    assert transaction["selected_product_ids"] == ["duplicate_geometry"]
    assert transaction["amount_total"] == 999
    assert transaction["access_active"] is False

    await isolated_checkout.users.insert_one(
        {
            "_id": ObjectId(user["user_id"]),
            "is_premium": False,
            "entitlements": [],
        }
    )
    fake_sessions.retrieve = lambda *_args, **_kwargs: {
            "id": response.session_id,
            "status": "open",
            "payment_status": "unpaid",
            "amount_total": 999,
            "currency": "usd",
            "metadata": captured["metadata"],
        }
    monkeypatch.setattr(server.stripe.checkout.Session, "retrieve", fake_sessions.retrieve)
    status = await server.get_checkout_status(
        response.session_id,
        request=None,
        current_user=user,
    )
    assert status.session_id == response.session_id
    assert status.package_id == "svg_micro_eco_lifetime"
    assert status.payment_status == "unpaid"
    assert status.amount_total == 999
    assert status.entitlements == []


@pytest.mark.anyio
async def test_missing_configuration_and_bad_origin_create_no_record(
    isolated_checkout,
    monkeypatch,
):
    monkeypatch.setenv("SVG_SUBSCRIPTION_CHECKOUT_ENABLED", "1")
    monkeypatch.setenv(
        "STRIPE_SVG_INTEGRATION_IDENTIFIER",
        "svg_micro_eco_test",
    )
    monkeypatch.setenv("STRIPE_PRICE_DUPLICATE_GEOMETRY_LIFETIME", "")

    with pytest.raises(HTTPException):
        await server.create_svg_subscription_checkout_session(
            checkout_request(),
            request=None,
            current_user=current_user(),
        )

    bad_origin = checkout_request()
    bad_origin.origin_url = "https://attacker.example/return"
    with pytest.raises(HTTPException):
        await server.create_svg_subscription_checkout_session(
            bad_origin,
            request=None,
            current_user=current_user(),
        )

    assert await isolated_checkout.payment_transactions.count_documents({}) == 0
