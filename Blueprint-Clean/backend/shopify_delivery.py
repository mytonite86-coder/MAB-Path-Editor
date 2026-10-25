"""Secure delivery helpers for M.A.B. Shopify activation licenses."""

import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage

from email_validator import EmailNotValidError, validate_email


@dataclass(frozen=True)
class SmtpConfig:
    host: str
    port: int
    sender: str
    username: str | None
    password: str | None
    starttls: bool


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


def load_smtp_config() -> SmtpConfig:
    """Load a complete SMTP configuration without inventing credentials."""
    host = os.environ.get("MAB_LICENSE_SMTP_HOST", "").strip()
    sender = os.environ.get("MAB_LICENSE_FROM_EMAIL", "").strip()
    username = os.environ.get("MAB_LICENSE_SMTP_USERNAME", "").strip() or None
    password = os.environ.get("MAB_LICENSE_SMTP_PASSWORD", "").strip() or None

    if not host or not sender:
        raise RuntimeError("M.A.B. activation email delivery is not configured.")
    if bool(username) != bool(password):
        raise RuntimeError("SMTP username and password must be configured together.")

    try:
        port = int(os.environ.get("MAB_LICENSE_SMTP_PORT", "587"))
    except ValueError as exc:
        raise RuntimeError("M.A.B. activation SMTP port is invalid.") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("M.A.B. activation SMTP port is invalid.")

    starttls = os.environ.get("MAB_LICENSE_SMTP_STARTTLS", "true").lower()
    if starttls not in {"true", "false"}:
        raise RuntimeError("MAB_LICENSE_SMTP_STARTTLS must be true or false.")

    try:
        normalized_sender = validate_email(
            sender,
            check_deliverability=False,
        ).normalized
    except EmailNotValidError as exc:
        raise RuntimeError("M.A.B. activation sender email is invalid.") from exc

    return SmtpConfig(
        host=host,
        port=port,
        sender=normalized_sender,
        username=username,
        password=password,
        starttls=starttls == "true",
    )


def send_shopify_activation_email(
    recipient: str,
    activation_code: str,
    order_id: str,
    unit: int,
) -> None:
    """Deliver one purchased license without logging or returning its code."""
    config = load_smtp_config()
    try:
        normalized_recipient = validate_email(
            recipient,
            check_deliverability=False,
        ).normalized
    except EmailNotValidError as exc:
        raise ValueError("The purchaser email is invalid.") from exc

    message = EmailMessage()
    message["Subject"] = "Your M.A.B. S1 activation code"
    message["From"] = config.sender
    message["To"] = normalized_recipient
    message.set_content(
        "Thank you for purchasing M.A.B. S1.\n\n"
        f"Activation code: {activation_code}\n\n"
        "Sign in to your M.A.B. account and redeem this code to unlock "
        "permanent M.A.B. S1 access. This code is single-use and does not "
        "include automatic M.A.B. S2 access.\n\n"
        f"Shopify order: {order_id}; license unit: {unit}.\n"
    )

    with smtplib.SMTP(config.host, config.port, timeout=20) as smtp:
        if config.starttls:
            smtp.starttls()
        if config.username and config.password:
            smtp.login(config.username, config.password)
        smtp.send_message(message)
