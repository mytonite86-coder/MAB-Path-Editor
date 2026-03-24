import pytest


# AI module regression: deterministic primitive generation for text-to-CAD solid prompts.
class TestAITextToCadPrimitives:
    def test_block_prompt_returns_single_rectangle_with_expected_depth(self, api_client, base_url):
        response = api_client.post(
            f"{base_url}/api/ai/text-to-cad",
            json={"prompt": "Create a solid 50mm x 30mm x 20mm rectangular block"},
        )

        assert response.status_code == 200
        data = response.json()

        elements = data.get("elements", [])
        assert len(elements) == 1

        element = elements[0]
        assert element.get("type") == "rectangle"
        assert isinstance(element.get("points"), list) and len(element["points"]) == 2
        assert pytest.approx(float(element.get("properties", {}).get("depth", 0)), 0.001) == 20.0

    def test_cylinder_prompt_returns_single_circle_with_cylinder_depth(self, api_client, base_url):
        response = api_client.post(
            f"{base_url}/api/ai/text-to-cad",
            json={"prompt": "Create a 40mm diameter x 60mm tall cylinder"},
        )

        assert response.status_code == 200
        data = response.json()

        elements = data.get("elements", [])
        assert len(elements) == 1

        element = elements[0]
        properties = element.get("properties", {})
        assert element.get("type") == "circle"
        assert pytest.approx(float(properties.get("depth", 0)), 0.001) == 60.0
        assert pytest.approx(float(properties.get("radius", 0)), 0.001) == 20.0
