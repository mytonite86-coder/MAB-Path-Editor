import time

import pytest


# Payments module regression: package listing, Stripe checkout session/status, and disabled direct premium activation.
class TestPaymentsStripeFlow:
    @pytest.fixture
    def auth_ctx(self, api_client, base_url):
        ts = int(time.time() * 1000)
        email = f"TEST_payments_{ts}@example.com"
        payload = {
            "email": email,
            "username": f"TEST_payments_{ts}",
            "password": "TestPass123!",
        }

        register_response = api_client.post(f"{base_url}/api/auth/register", json=payload)
        assert register_response.status_code == 200

        data = register_response.json()
        token = data.get("access_token")
        assert isinstance(token, str) and token

        return {
            "token": token,
            "headers": {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        }

    def test_get_packages_returns_at_least_one_upgrade(self, api_client, base_url):
        response = api_client.get(f"{base_url}/api/payments/packages")
        assert response.status_code == 200

        packages = response.json()
        assert isinstance(packages, list)
        assert len(packages) >= 1
        assert packages[0].get("package_id")
        assert isinstance(packages[0].get("amount"), (int, float))

    def test_create_checkout_session_authenticated_user(self, api_client, base_url, auth_ctx):
        packages_response = api_client.get(f"{base_url}/api/payments/packages")
        assert packages_response.status_code == 200
        package_id = packages_response.json()[0]["package_id"]

        response = api_client.post(
            f"{base_url}/api/payments/checkout/session",
            headers=auth_ctx["headers"],
            json={"package_id": package_id, "origin_url": base_url},
        )
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data.get("session_id"), str) and data["session_id"].startswith("cs_")
        assert isinstance(data.get("url"), str) and data["url"].startswith("http")

    def test_checkout_status_before_payment_returns_open_unpaid_state(self, api_client, base_url, auth_ctx):
        packages_response = api_client.get(f"{base_url}/api/payments/packages")
        assert packages_response.status_code == 200
        package_id = packages_response.json()[0]["package_id"]

        session_response = api_client.post(
            f"{base_url}/api/payments/checkout/session",
            headers=auth_ctx["headers"],
            json={"package_id": package_id, "origin_url": base_url},
        )
        assert session_response.status_code == 200
        session_id = session_response.json()["session_id"]

        status_response = api_client.get(
            f"{base_url}/api/payments/checkout/status/{session_id}",
            headers=auth_ctx["headers"],
        )
        assert status_response.status_code == 200

        status_data = status_response.json()
        assert status_data.get("session_id") == session_id
        assert status_data.get("package_id") == package_id
        assert status_data.get("is_premium") is False
        assert status_data.get("status") in {"open", "complete", "expired"}
        assert status_data.get("payment_status") in {"unpaid", "pending", "no_payment_required"}

    def test_direct_premium_activation_is_disabled(self, api_client, base_url, auth_ctx):
        activate_response = api_client.post(
            f"{base_url}/api/premium/activate",
            headers=auth_ctx["headers"],
            json={"code": "disabled-test-value"},
        )
        assert activate_response.status_code == 501
