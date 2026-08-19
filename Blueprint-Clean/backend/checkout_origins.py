import os
from urllib.parse import urlparse


DEFAULT_CHECKOUT_ALLOWED_ORIGINS = {
    "https://mytonite86-coder.github.io",
    "https://mytonite86-coder.github.io/MAB-Path-Editor",
    "https://mytonite86-coder.github.io/svg-path-closer",
}

DEFAULT_CHECKOUT_ALLOWED_SCHEMES = {
    "mabs1patheditor",
}


def configured_checkout_origins() -> set[str]:
    configured = {
        value.strip().rstrip("/")
        for value in os.environ.get(
            "CHECKOUT_ALLOWED_ORIGINS",
            "",
        ).split(",")
        if value.strip()
    }
    return DEFAULT_CHECKOUT_ALLOWED_ORIGINS | configured


def validate_checkout_origin(origin_url: str) -> str:
    normalized = origin_url.strip().rstrip("/")
    parsed = urlparse(normalized)

    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Checkout origin contains unsupported URL components")

    if parsed.scheme in {"http", "https"}:
        if not parsed.netloc or normalized not in configured_checkout_origins():
            raise ValueError("Checkout origin is not allowlisted")
        return normalized

    if parsed.scheme in DEFAULT_CHECKOUT_ALLOWED_SCHEMES:
        return normalized

    raise ValueError("Checkout origin is not allowlisted")
