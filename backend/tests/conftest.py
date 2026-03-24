import os

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
    return url.rstrip("/")


@pytest.fixture
def api_client() -> requests.Session:
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session
