import unittest

from subscription_policy import (
    has_any_entitlement,
    pathseal_access_action,
    subscription_access_action,
)


class PathSealSubscriptionPolicyTests(unittest.TestCase):
    def test_access_granting_statuses(self):
        for status in ("active", "trialing", "past_due"):
            with self.subTest(status=status):
                self.assertEqual(pathseal_access_action(status), "grant")

    def test_access_revoking_statuses(self):
        for status in (
            "canceled",
            "unpaid",
            "incomplete_expired",
            "paused",
        ):
            with self.subTest(status=status):
                self.assertEqual(pathseal_access_action(status), "revoke")

    def test_incomplete_and_unknown_statuses_hold_current_state(self):
        for status in ("incomplete", "", "future_stripe_status"):
            with self.subTest(status=status):
                self.assertEqual(pathseal_access_action(status), "hold")

    def test_generic_subscription_policy_matches_legacy_pathseal_alias(self):
        for status in ("active", "canceled", "incomplete"):
            with self.subTest(status=status):
                self.assertEqual(
                    subscription_access_action(status),
                    pathseal_access_action(status),
                )

    def test_permanent_entitlement_preserves_access_after_cancellation(self):
        permanent = {
            "mab_s1",
            "founder_lifetime",
            "complimentary_lifetime",
            "all_products_lifetime",
        }
        self.assertTrue(has_any_entitlement(["mab_s1"], permanent))
        self.assertTrue(
            has_any_entitlement(["all_products_lifetime"], permanent)
        )
        self.assertFalse(
            has_any_entitlement(["mab_s1_subscription"], permanent)
        )


if __name__ == "__main__":
    unittest.main()
