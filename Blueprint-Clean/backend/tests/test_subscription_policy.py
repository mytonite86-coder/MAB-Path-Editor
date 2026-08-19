import unittest

from subscription_policy import pathseal_access_action


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


if __name__ == "__main__":
    unittest.main()
