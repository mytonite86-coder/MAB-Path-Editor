"""S&K order fulfillment email via Gmail's HTTPS API.

The sender remains the existing S&K mailbox, not an external email brand.
Only the minimum gmail.send OAuth scope is required.
"""
import base64
import os
from email.message import EmailMessage

import requests
from email_validator import EmailNotValidError, validate_email

from fulfillment_router import TIMEZONE

GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
MAB_LOGIN_URL = "https://tinyurl.com/MAB-S1-Path-Editor"


def normalize_shopify_customer_email(order: dict) -> str:
    """Return the paid order's normalized purchaser email or fail closed."""
    customer = order.get("customer") or {}
    candidate = (
        order.get("email")
        or order.get("contact_email")
        or customer.get("email")
        or ""
    )
    try:
        return validate_email(
            candidate,
            check_deliverability=False,
        ).normalized.lower()
    except EmailNotValidError as exc:
        raise ValueError("A valid purchaser email is required for delivery.") from exc


def _valid_email(value: str) -> str:
    try:
        return validate_email(value, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError("A valid email address is required for fulfillment.") from exc


def _gmail_credentials():
    """Fail before attempting delivery if OAuth credentials are incomplete."""
    sender = _valid_email(os.environ.get("MAB_LICENSE_FROM_EMAIL", "").strip())
    keys = (
        "GMAIL_OAUTH_CLIENT_ID",
        "GMAIL_OAUTH_CLIENT_SECRET",
        "GMAIL_OAUTH_REFRESH_TOKEN",
    )
    values = [os.environ.get(key, "").strip() for key in keys]
    if not all(values):
        raise RuntimeError("Gmail HTTPS sender OAuth setup is incomplete.")
    return sender, *values


def _gmail_access_token(client_id: str, client_secret: str, refresh_token: str):
    try:
        response = requests.post(
            GMAIL_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=12,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Gmail OAuth endpoint was unreachable.") from exc
    if response.status_code != 200:
        raise RuntimeError(
            f"Gmail OAuth refresh failed (HTTP {response.status_code})."
        )
    try:
        token = response.json()["access_token"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("Gmail OAuth returned no usable access token.") from exc
    if not isinstance(token, str) or not token:
        raise RuntimeError("Gmail OAuth returned an invalid access token.")
    return token


def compose_fulfillment_message(
    sender: str,
    recipient: str,
    order_id: str,
    activation_codes: list,
    services: list,
    timezone: str = TIMEZONE,
) -> EmailMessage:
    """Compose strictly relevant sections; never leak a code into service mail."""
    if not activation_codes and not services:
        raise ValueError("No fulfillment items to email.")
    sender = _valid_email(sender)
    recipient = _valid_email(recipient)
    order_id = str(order_id)
    message = EmailMessage()
    message["From"] = f"S&K Productions <{sender}>"
    message["To"] = recipient
    if activation_codes and services:
        message["Subject"] = f"S&K Productions order {order_id}: access and scheduling"
    elif activation_codes:
        message["Subject"] = "Your M.A.B. S1 activation code"
    else:
        message["Subject"] = f"S&K Productions order {order_id}: schedule your service"

    paragraphs = [
        "Thank you for your S&K Productions purchase.",
        f"Shopify order: {order_id}.",
    ]
    if activation_codes:
        lines = [
            "M.A.B. S1 ACTIVATION",
            "Your permanent M.A.B. S1 license:",
        ]
        for entry in activation_codes:
            lines.append(
                f"License unit: {entry['unit']}; activation code: {entry['activation_code']}"
            )
        lines.extend([
            "",
            f"1. Log in to your M.A.B. account: {MAB_LOGIN_URL}",
            "2. Open Access and choose Submit Activation Code "
            "(the Activate Access panel).",
            "3. Enter the code and select ACTIVATE.",
            "Each code is single-use and unlocks the mab_s1 entitlement once.",
            "M.A.B. S2 is not included.",
        ])
        paragraphs.append("\n".join(lines))

    if services:
        lines = [
            "SERVICE SCHEDULING",
            "Tell us the day you would like the work performed, "
            "or the day you need it completed by.",
            "",
            "Your purchased service(s):",
        ]
        for service in services:
            label = service["service_name"]
            if service.get("quantity", 1) > 1:
                label += f" (quantity {service['quantity']})"
            lines.append(f"- {label}")
            lines.append(
                f"  Estimated duration: {service.get('estimated_duration') or 'to be confirmed'}"
            )
            if service.get("desired_date"):
                lines.append(f"  Requested date: {service['desired_date']}")
        lines.extend([
            "",
            f"Work takes place in scheduled blocks from 10 AM to 10 PM ({timezone}).",
            "Each block is sized to the task's estimated duration. "
            "We will confirm the exact block that fits on your requested day "
            "or sooner. If that day is full, we will offer the next available start.",
            "Reply to this email with your preferred work date or completion deadline.",
        ])
        paragraphs.append("\n".join(lines))

    message.set_content("\n\n".join(paragraphs) + "\n")
    return message


def send_shopify_fulfillment_email(
    recipient: str,
    order_id: str,
    activation_codes: list,
    services: list,
    timezone: str = TIMEZONE,
) -> str:
    """Send with Gmail over HTTPS, return provider message ID, never log codes."""
    sender, client_id, client_secret, refresh_token = _gmail_credentials()
    message = compose_fulfillment_message(
        sender, recipient, order_id, activation_codes, services, timezone
    )
    token = _gmail_access_token(client_id, client_secret, refresh_token)
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
    try:
        response = requests.post(
            GMAIL_SEND_URL,
            headers={"Authorization": f"Bearer {token}"},
            json={"raw": raw},
            timeout=18,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Gmail HTTPS send request failed.") from exc
    if response.status_code not in (200, 201):
        raise RuntimeError(f"Gmail message send failed (HTTP {response.status_code}).")
    try:
        provider_id = response.json()["id"]
    except (ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("Gmail send returned no provider message ID.") from exc
    if not isinstance(provider_id, str) or not provider_id:
        raise RuntimeError("Gmail send returned an invalid provider message ID.")
    return provider_id


def send_shopify_activation_email(
    recipient: str, activation_code: str, order_id: str, unit: int
) -> str:
    """Legacy call compatibility; uses the shared Gmail HTTPS sender."""
    return send_shopify_fulfillment_email(
        recipient, order_id,
        [{"unit": unit, "activation_code": activation_code}], []
    )
