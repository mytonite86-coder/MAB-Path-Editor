#!/usr/bin/env python3
"""Run only against isolated SVG staging with Stripe's published test card."""
import re
import sys
import time
from uuid import uuid4
from urllib.parse import urlparse
import requests
from playwright.sync_api import sync_playwright

BASE = "https://svg-micro-eco-payment-staging.onrender.com"
TOOLS = {"pathseal", "duplicate_geometry", "stray_node_cleaner", "overlapping_shape_repair", "curve_repair"}

def api(method, path, token=None, payload=None):
    headers = {"Authorization": "Bearer " + token} if token else {}
    response = requests.request(method, BASE + path, headers=headers, json=payload, timeout=30)
    try:
        data = response.json()
    except Exception:
        raise AssertionError(f"Non-JSON HTTP {response.status_code} from {path}")
    assert response.ok, f"{path}: HTTP {response.status_code}: {str(data)[:400]}"
    return data

def fill(page, selectors, value, required=False):
    for _ in range(32 if required else 2):
        for frame in page.frames:
            for selector in selectors:
                loc = frame.locator(selector).first
                try:
                    if loc.count() and loc.is_visible(timeout=500):
                        loc.fill(value, timeout=5000)
                        return True
                except Exception:
                    continue
        page.wait_for_timeout(400)
    if required:
        fields = []
        for frame in page.frames:
            try:
                fields += frame.locator("input").evaluate_all(
                    "(xs) => xs.map(x => ({name:x.name,placeholder:x.placeholder,autocomplete:x.autocomplete}))"
                )
            except Exception:
                pass
        raise AssertionError(f"Missing required Stripe test card field {selectors}. Inputs: {str(fields)[:1800]}")
    return False

def pay(page, url):
    u = urlparse(url)
    assert u.scheme == "https" and u.hostname == "checkout.stripe.com", "Not hosted Stripe checkout"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(4500)
    print("HOSTED CHECKOUT PAGE:", page.url, flush=True)
    print("HOSTED CHECKOUT TEXT:", page.locator("body").inner_text()[:2400], flush=True)
    print("HOSTED CHECKOUT BUTTONS:", page.locator("button").all_text_contents()[:40], flush=True)
    print("HOSTED CHECKOUT FRAMES:", [(f.url or "")[:130] for f in page.frames], flush=True)
    fill(page, ['input[name="cardNumber"]','input[autocomplete="cc-number"]','input[placeholder*="1234 1234"]'], "4242424242424242", True)
    fill(page, ['input[name="cardExpiry"]','input[autocomplete="cc-exp"]','input[placeholder*="MM"]'], "1235", True)
    fill(page, ['input[name="cardCvc"]','input[autocomplete="cc-csc"]','input[placeholder*="CVC" i]'], "123", True)
    fill(page, ['input[name="billingName"]','input[autocomplete="cc-name"]'], "SVG Staging Tester")
    fill(page, ['input[name="billingPostalCode"]','input[autocomplete="postal-code"]'], "84101")
    for selector in ['button[type="submit"]','button:has-text("Pay")','button:has-text("Complete")']:
        loc = page.locator(selector)
        for k in range(min(loc.count(), 5)):
            b = loc.nth(k)
            try:
                if b.is_visible() and b.is_enabled():
                    b.click(timeout=10000)
                    return
            except Exception:
                continue
    raise AssertionError("No enabled Stripe checkout payment button")

def run():
    nonce = uuid4().hex[:10]
    reg = api("POST", "/api/auth/register", payload={
        "email": f"svg-e2e-{nonce}@example.com",
        "username": "svge2e" + nonce,
        "password": "TestOnlyPassword-" + nonce,
    })
    token = reg["access_token"]
    assert not reg["user"].get("entitlements"), "Fresh test user already has access"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        page = browser.new_page()
        for product, amount, expected in [
            ("pathseal", 999, {"pathseal"}),
            ("svg_complete_bundle", 3499, TOOLS),
        ]:
            before = api("GET", "/api/auth/me", token=token)
            current = set(before.get("entitlements") or []) & TOOLS
            assert current == ({"pathseal"} if product == "svg_complete_bundle" else set()), f"Unexpected starting access {current}"
            session = api("POST", "/api/payments/svg-subscription/checkout/session", token=token, payload={
                "selected_product_ids": [product], "origin_url": BASE + "/svg-test",
            })
            sid = session.get("session_id", "")
            assert sid.startswith("cs_test_"), "Checkout is not Stripe TEST mode"
            status = api("GET", "/api/payments/checkout/status/" + sid, token=token)
            assert status.get("amount_total") == amount, f"Incorrect price on {product}"
            assert status.get("payment_status") != "paid", "Checkout is prematurely paid"
            print(f"Stripe TEST Checkout created: {product}, USD {amount/100:.2f}, mode one-time", flush=True)
            pay(page, session["url"])
            print("Test card submitted, checking signed webhook entitlement...", flush=True)
            last = None
            for _ in range(25):
                last = api("GET", "/api/auth/me", token=token)
                ent = set(last.get("entitlements") or []) & TOOLS
                life = set(last.get("svg_lifetime_entitlements") or []) & TOOLS
                if ent == expected and life == expected:
                    break
                time.sleep(3)
            else:
                raise AssertionError(f"{product} lifetime access missing; account: {last}; Stripe page: {page.url}")
            print(f"PASS: {product}: exactly {sorted(expected)} permanently entitled", flush=True)
        browser.close()
    print("PASS: both fake payments fulfilled; no production changes", flush=True)

if __name__ == "__main__":
    try:
        run()
    except Exception as err:
        print(f"FAILED Stripe hosted TEST Checkout: {err}", file=sys.stderr, flush=True)
        raise
