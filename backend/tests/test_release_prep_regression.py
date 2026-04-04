import time

import pytest


# Release-prep regression: auth/profile integrity and Stripe custom-scheme checkout origin support.
class TestReleasePrepRegression:
    @pytest.fixture
    def auth_ctx(self, api_client, base_url):
        ts = int(time.time() * 1000)
        email = f"TEST_releaseprep_{ts}@example.com"
        password = "Secret123!"
        username = f"TEST_releaseprep_{ts}"

        register_response = api_client.post(
            f"{base_url}/api/auth/register",
            json={"email": email, "username": username, "password": password},
        )
        assert register_response.status_code == 200

        token = register_response.json().get("access_token")
        assert isinstance(token, str) and token

        login_response = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": email, "password": password},
        )
        assert login_response.status_code == 200
        assert login_response.json().get("user", {}).get("email") == email

        return {
            "email": email,
            "headers": {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        }

    def test_health_endpoint_is_alive(self, api_client, base_url):
        response = api_client.get(f"{base_url}/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body.get("status") == "healthy"

    def test_auth_login_then_me_returns_same_user(self, api_client, base_url, auth_ctx):
        me_response = api_client.get(f"{base_url}/api/auth/me", headers=auth_ctx["headers"])
        assert me_response.status_code == 200
        me_data = me_response.json()
        assert me_data.get("email") == auth_ctx["email"]
        assert me_data.get("is_premium") is False

    def test_checkout_session_accepts_cadblueprint_custom_scheme_origin(self, api_client, base_url, auth_ctx):
        packages_response = api_client.get(f"{base_url}/api/payments/packages")
        assert packages_response.status_code == 200
        packages = packages_response.json()
        assert isinstance(packages, list) and len(packages) > 0
        package_id = packages[0]["package_id"]

        checkout_response = api_client.post(
            f"{base_url}/api/payments/checkout/session",
            headers=auth_ctx["headers"],
            json={"package_id": package_id, "origin_url": "cadblueprint://profile"},
        )
        assert checkout_response.status_code == 200
        checkout_data = checkout_response.json()
        assert isinstance(checkout_data.get("session_id"), str) and checkout_data["session_id"].startswith("cs_")
        assert isinstance(checkout_data.get("url"), str) and checkout_data["url"].startswith("http")
