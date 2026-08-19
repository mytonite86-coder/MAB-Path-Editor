import os
from urllib.parse import urlparse

import pytest
import requests
from dotenv import load_dotenv


# Shared test environment fixture for public preview URL.
load_dotenv("/app/frontend/.env")


@pytest.fixture(scope="session")
def base_url() -> str:
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not url:
        pytest.skip("EXPO_PUBLIC_BACKEND_URL is not configured")

    hostname = (urlparse(url).hostname or "").lower()
    if hostname.endswith(".onrender.com"):
        pytest.fail("Integration tests must never target a Render production service")

    if os.environ.get("ALLOW_DESTRUCTIVE_INTEGRATION_TESTS") != "1":
        pytest.skip(
            "Set ALLOW_DESTRUCTIVE_INTEGRATION_TESTS=1 for an isolated test environment"
        )

    return url.rstrip("/")


@pytest.fixture
def api_client() -> requests.Session:
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
