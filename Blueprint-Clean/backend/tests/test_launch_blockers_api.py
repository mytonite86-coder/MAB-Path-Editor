import time

import pytest


# Launch blockers: auth, disabled direct activation, blueprint persistence, and checkout bootstrap.
class TestLaunchBlockersApi:
    @pytest.fixture
    def auth_ctx(self, api_client, base_url):
        ts = int(time.time() * 1000)
        email = f"TEST_launch_{ts}@example.com"
        password = "Secret123!"
        username = f"TEST_launch_{ts}"

        register_response = api_client.post(
            f"{base_url}/api/auth/register",
            json={"email": email, "username": username, "password": password},
        )
        assert register_response.status_code == 200
        register_data = register_response.json()
        token = register_data.get("access_token")
        assert isinstance(token, str) and token

        login_response = api_client.post(
            f"{base_url}/api/auth/login",
            json={"email": email, "password": password},
        )
        assert login_response.status_code == 200
        assert login_response.json().get("user", {}).get("email") == email

        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        return {"email": email, "token": token, "headers": headers}

    def test_auth_me_returns_registered_user_profile(self, api_client, base_url, auth_ctx):
        me_response = api_client.get(f"{base_url}/api/auth/me", headers=auth_ctx["headers"])
        assert me_response.status_code == 200

        me_data = me_response.json()
        assert me_data.get("email") == auth_ctx["email"]
        assert me_data.get("is_premium") is False

    def test_direct_premium_activation_remains_disabled(self, api_client, base_url, auth_ctx):
        activate_response = api_client.post(
            f"{base_url}/api/premium/activate",
            headers=auth_ctx["headers"],
            json={"code": "disabled-test-value"},
        )
        assert activate_response.status_code == 501

    def test_blueprint_create_get_list_delete_persists_correctly(self, api_client, base_url, auth_ctx):
        blueprint_payload = {
            "name": "TEST_launch_blueprint",
            "description": "launch flow",
            "elements": [
                {
                    "type": "line",
                    "points": [[10, 10], [120, 120]],
                    "properties": {"color": "#000000", "strokeWidth": 2, "depth": 10},
                }
            ],
            "tags": ["TEST"],
        }

        create_response = api_client.post(
            f"{base_url}/api/blueprints",
            headers=auth_ctx["headers"],
            json=blueprint_payload,
        )
        assert create_response.status_code == 200
        created = create_response.json()
        blueprint_id = created.get("id")
        assert isinstance(blueprint_id, str) and blueprint_id
        assert created.get("name") == "TEST_launch_blueprint"

        get_response = api_client.get(
            f"{base_url}/api/blueprints/{blueprint_id}",
            headers=auth_ctx["headers"],
        )
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched.get("id") == blueprint_id
        assert fetched.get("elements", [])[0].get("type") == "line"

        list_response = api_client.get(f"{base_url}/api/blueprints", headers=auth_ctx["headers"])
        assert list_response.status_code == 200
        listed = list_response.json()
        assert any(item.get("id") == blueprint_id for item in listed)

        delete_response = api_client.delete(
            f"{base_url}/api/blueprints/{blueprint_id}",
            headers=auth_ctx["headers"],
        )
        assert delete_response.status_code == 200

        get_after_delete = api_client.get(
            f"{base_url}/api/blueprints/{blueprint_id}",
            headers=auth_ctx["headers"],
        )
        assert get_after_delete.status_code == 404

    def test_payment_package_render_and_checkout_session_launch_data(self, api_client, base_url, auth_ctx):
        packages_response = api_client.get(f"{base_url}/api/payments/packages")
        assert packages_response.status_code == 200
        packages = packages_response.json()
        assert isinstance(packages, list) and len(packages) > 0
        package_id = packages[0]["package_id"]

        checkout_response = api_client.post(
            f"{base_url}/api/payments/checkout/session",
            headers=auth_ctx["headers"],
            json={"package_id": package_id, "origin_url": base_url},
        )
        assert checkout_response.status_code == 200
        checkout_data = checkout_response.json()
        assert checkout_data.get("url", "").startswith("http")
        assert checkout_data.get("session_id", "").startswith("cs_")
