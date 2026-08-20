import unittest

from svg_subscription import (
    SVG_MULTI_TOOL_DISCOUNT_PERCENT,
    SVG_TOOL_CATALOG,
    SvgSubscriptionSelectionError,
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


if __name__ == "__main__":
    unittest.main()
