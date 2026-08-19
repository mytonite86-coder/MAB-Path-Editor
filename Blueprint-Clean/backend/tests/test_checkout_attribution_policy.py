import unittest

from checkout_attribution import (
    attribution_metadata,
    build_payment_completed_event,
    normalize_checkout_attribution,
)


class CheckoutAttributionPolicyTests(unittest.TestCase):
    def test_normalizes_untrusted_browser_values(self):
        attribution = normalize_checkout_attribution(
            {
                "visitor_id": " visitor-1 ",
                "source": "",
                "medium": " social ",
                "campaign": "x" * 250,
                "ignored": "secret",
            }
        )

        self.assertEqual(attribution["visitor_id"], "visitor-1")
        self.assertEqual(attribution["source"], "direct")
        self.assertEqual(attribution["medium"], "social")
        self.assertEqual(len(attribution["campaign"]), 200)
        self.assertNotIn("ignored", attribution)

    def test_builds_minimal_payment_event_without_customer_data(self):
        event = build_payment_completed_event(
            {
                "user_id": "user-7",
                "email": "buyer@example.com",
                "session_id": "cs_secret",
                "attribution": {
                    "visitor_id": "visitor-7",
                    "source": "facebook",
                    "medium": "social",
                    "campaign": "pathseal-01",
                },
            },
            occurred_at="2026-08-19T12:00:00+00:00",
        )

        self.assertEqual(event["type"], "payment_completed")
        self.assertEqual(event["product"], "pathseal")
        self.assertEqual(event["visitorId"], "visitor-7")
        self.assertEqual(event["userId"], "user-7")
        self.assertNotIn("email", event)
        self.assertNotIn("session_id", event)
        self.assertNotIn("amount", event)

    def test_stripe_metadata_uses_bounded_attribution_only(self):
        metadata = attribution_metadata(
            {
                "visitor_id": "visitor-3",
                "source": "newsletter",
                "medium": "email",
                "campaign": "launch",
            }
        )

        self.assertEqual(
            set(metadata),
            {"sd_visitor_id", "sd_source", "sd_medium", "sd_campaign"},
        )


if __name__ == "__main__":
    unittest.main()
