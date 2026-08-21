import unittest

from svg_subscription import (
    SVG_MULTI_TOOL_DISCOUNT_PERCENT,
    SVG_DISCOUNT_COUPON_ENV,
    SVG_TOOL_CATALOG,
    SVG_TOOL_PRICE_ENV,
    SvgSubscriptionSelectionError,
    build_svg_checkout_plan,
    parse_svg_product_ids,
    plan_svg_entitlement_transition,
    quote_svg_subscription,
)


class SvgSubscriptionQuoteTests(unittest.TestCase):
    def test_approved_pricing_ladder(self):
        expected_totals = {
            1: 999,
            2: 1898,
            3: 2697,
            4: 3397,
            5: 3996,
        }
        product_ids = list(SVG_TOOL_CATALOG)

        for tool_count, expected_total in expected_totals.items():
            with self.subTest(tool_count=tool_count):
                original_availability = {
                    product_id: SVG_TOOL_CATALOG[product_id]["available"]
                    for product_id in product_ids[:tool_count]
                }
                try:
                    for product_id in product_ids[:tool_count]:
                        SVG_TOOL_CATALOG[product_id]["available"] = True

                    quote = quote_svg_subscription(
                        product_ids[:tool_count]
                    )
                finally:
                    for product_id, available in original_availability.items():
                        SVG_TOOL_CATALOG[product_id]["available"] = available

                self.assertEqual(quote["unit_amount_cents"], 999)
                self.assertEqual(quote["subtotal_cents"], 999 * tool_count)
                self.assertEqual(
                    quote["discount_percent"],
                    SVG_MULTI_TOOL_DISCOUNT_PERCENT[tool_count],
                )
                self.assertEqual(quote["total_cents"], expected_total)
                self.assertTrue(
                    all(
                        line_item["unit_amount_cents"] == 999
                        for line_item in quote["line_items"]
                    )
                )

    def test_current_two_tool_selection_receives_five_percent_discount(self):
        quote = quote_svg_subscription(
            ["pathseal", "duplicate_geometry"]
        )

        self.assertEqual(quote["subtotal_cents"], 1998)
        self.assertEqual(quote["discount_percent"], 5)
        self.assertEqual(quote["discount_cents"], 100)
        self.assertEqual(quote["total_cents"], 1898)
        self.assertEqual(
            quote["selected_product_ids"],
            ["pathseal", "duplicate_geometry"],
        )

    def test_rejects_empty_duplicate_unknown_and_unavailable_selections(self):
        invalid_selections = (
            [],
            ["pathseal", "pathseal"],
            ["not_a_product"],
            ["stray_node_cleaner"],
        )

        for selection in invalid_selections:
            with self.subTest(selection=selection):
                with self.assertRaises(SvgSubscriptionSelectionError):
                    quote_svg_subscription(selection)

    def test_builds_separate_stripe_items_and_count_discount(self):
        configuration = {
            SVG_TOOL_PRICE_ENV["pathseal"]: "price_pathseal_test",
            SVG_TOOL_PRICE_ENV["duplicate_geometry"]: "price_duplicate_test",
            SVG_DISCOUNT_COUPON_ENV[2]: "coupon_two_tools_test",
        }

        plan = build_svg_checkout_plan(
            ["pathseal", "duplicate_geometry"],
            configuration,
        )

        self.assertEqual(
            plan["line_items"],
            [
                {"price": "price_pathseal_test", "quantity": 1},
                {"price": "price_duplicate_test", "quantity": 1},
            ],
        )
        self.assertEqual(
            plan["discounts"],
            [{"coupon": "coupon_two_tools_test"}],
        )
        self.assertEqual(
            plan["metadata"]["selected_product_ids"],
            "pathseal,duplicate_geometry",
        )
        self.assertEqual(plan["quote"]["total_cents"], 1898)

    def test_single_tool_checkout_has_no_bundle_coupon(self):
        plan = build_svg_checkout_plan(
            ["pathseal"],
            {
                SVG_TOOL_PRICE_ENV["pathseal"]: "price_pathseal_test",
            },
        )

        self.assertEqual(plan["discounts"], [])
        self.assertEqual(plan["quote"]["total_cents"], 999)

    def test_checkout_plan_fails_closed_when_configuration_is_missing(self):
        with self.assertRaisesRegex(
            SvgSubscriptionSelectionError,
            "not configured",
        ):
            build_svg_checkout_plan(
                ["pathseal", "duplicate_geometry"],
                {},
            )

    def test_parses_bounded_subscription_product_metadata(self):
        self.assertEqual(
            parse_svg_product_ids("pathseal,duplicate_geometry"),
            ["pathseal", "duplicate_geometry"],
        )

        for value in ("pathseal,pathseal", "pathseal,unknown_product"):
            with self.subTest(value=value):
                with self.assertRaises(SvgSubscriptionSelectionError):
                    parse_svg_product_ids(value)

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
