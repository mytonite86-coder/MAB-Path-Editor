import unittest
from svg_subscription import plan_svg_entitlement_transition

class LegacySvgEntitlementTests(unittest.TestCase):
    def test_active_subscription_grants_current_and_revokes_removed_tools(self):
        transition = plan_svg_entitlement_transition(
            ["pathseal", "duplicate_geometry"],
            ["duplicate_geometry"],
            "active",
        )

        self.assertEqual(transition["action"], "grant")
        self.assertEqual(transition["grant"], ["duplicate_geometry"])
        self.assertEqual(transition["revoke"], ["pathseal"])

    def test_canceled_subscription_revokes_all_selected_tools(self):
        transition = plan_svg_entitlement_transition(
            ["pathseal", "duplicate_geometry"],
            ["pathseal", "duplicate_geometry"],
            "canceled",
        )

        self.assertEqual(transition["grant"], [])
        self.assertEqual(
            transition["revoke"],
            ["duplicate_geometry", "pathseal"],
        )

    def test_uncertain_subscription_status_never_changes_access(self):
        transition = plan_svg_entitlement_transition(
            ["pathseal"],
            ["pathseal", "duplicate_geometry"],
            "incomplete",
        )

        self.assertEqual(transition["action"], "hold")
        self.assertEqual(transition["grant"], [])
        self.assertEqual(transition["revoke"], [])


if __name__ == "__main__":
    unittest.main()
