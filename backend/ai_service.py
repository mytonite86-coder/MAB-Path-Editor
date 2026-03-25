from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from typing import List, Dict, Any, Optional
import json
import os
import re
import uuid
from dotenv import load_dotenv

load_dotenv()

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY")


class AICADService:
    """Service for AI-powered CAD generation using GPT-5.1"""
    
    def __init__(self):
        self.api_key = EMERGENT_LLM_KEY

    @staticmethod
    def _to_millimeters(value: str, unit: Optional[str]) -> float:
        numeric_value = float(value)
        scale = {
            "mm": 1.0,
            "cm": 10.0,
            "m": 1000.0,
            "in": 25.4,
            "inch": 25.4,
            "inches": 25.4,
        }
        return numeric_value * scale.get((unit or "mm").lower(), 1.0)

    @staticmethod
    def _safe_canvas_size(value: float, minimum: float = 5.0, maximum: float = 700.0) -> float:
        return max(minimum, min(value, maximum))

    def _build_centered_block(
        self,
        width_mm: float,
        height_mm: float,
        depth_mm: float,
        description: str,
    ) -> Dict[str, Any]:
        safe_width = self._safe_canvas_size(width_mm)
        safe_height = self._safe_canvas_size(height_mm)
        safe_depth = self._safe_canvas_size(depth_mm, maximum=500.0)
        half_width = safe_width / 2
        half_height = safe_height / 2

        return {
            "elements": [
                {
                    "type": "rectangle",
                    "points": [
                        [400 - half_width, 300 - half_height],
                        [400 + half_width, 300 + half_height],
                    ],
                    "properties": {
                        "color": "#000000",
                        "strokeWidth": 2,
                        "depth": safe_depth,
                        "filled": True,
                    },
                }
            ],
            "description": description,
            "generation_id": str(uuid.uuid4()),
        }

    def _build_centered_cylinder(
        self,
        diameter_mm: float,
        depth_mm: float,
        description: str,
    ) -> Dict[str, Any]:
        safe_diameter = self._safe_canvas_size(diameter_mm)
        safe_depth = self._safe_canvas_size(depth_mm, maximum=500.0)

        return {
            "elements": [
                {
                    "type": "circle",
                    "points": [[400, 300]],
                    "properties": {
                        "color": "#000000",
                        "strokeWidth": 2,
                        "radius": safe_diameter / 2,
                        "depth": safe_depth,
                        "filled": True,
                    },
                }
            ],
            "description": description,
            "generation_id": str(uuid.uuid4()),
        }

    def _line_with_three_d(
        self,
        start: List[float],
        end: List[float],
        label: str,
        three_d: Dict[str, Any],
        color: str = "#000000",
    ) -> Dict[str, Any]:
        return {
            "type": "line",
            "points": [start, end],
            "properties": {
                "color": color,
                "strokeWidth": 2,
                "depth": max(float(three_d.get("depth", 3)), 1),
                "label": label,
                "threeD": three_d,
            },
        }

    def _build_sheet_metal_channel_from_prompt(self, prompt: str) -> Optional[Dict[str, Any]]:
        normalized_prompt = prompt.lower().replace('"', ' inch ').replace("×", "x")

        if not all(keyword in normalized_prompt for keyword in ["3 sides", "wall", "hem"]):
            return None

        height_match = re.search(r"all\s+3\s+are\s+(\d+(?:\.\d+)?)\s*in(?:ch|ches)?\s+tall", normalized_prompt)
        slope_match = re.search(r"extended\s+(\d+(?:\.\d+)?)\s*in(?:ch|ches)?\s+45", normalized_prompt)
        left_match = re.search(r"left\s+wall\s+is\s+(\d+(?:\.\d+)?)\s*in(?:ch|ches)?", normalized_prompt)
        back_match = re.search(r"back\s+wall\s+is\s+(\d+(?:\.\d+)?)\s*in(?:ch|ches)?", normalized_prompt)
        hem_match = re.search(r"(\d+(?:\.\d+)?)\s*in(?:ch|ches)?\s+folded\s+backwards\s+hem", normalized_prompt)
        radius_match = re.search(r"@\s*(\d+(?:\.\d+)?)\s*in(?:ch|ches)?\s+diameter", normalized_prompt)
        right_matches = re.findall(r"(?:and|a)\s+(\d+(?:\.\d+)?)\s*in(?:ch|ches)?\s+wall", normalized_prompt)

        if not all([height_match, slope_match, left_match, back_match, hem_match]) or not right_matches:
            return None

        wall_height = self._to_millimeters(height_match.group(1), "in")
        slope_depth = self._to_millimeters(slope_match.group(1), "in")
        left_length = self._to_millimeters(left_match.group(1), "in")
        back_length = self._to_millimeters(back_match.group(1), "in")
        right_length = self._to_millimeters(right_matches[-1], "in")
        hem_size = self._to_millimeters(hem_match.group(1), "in")
        bend_radius = self._to_millimeters(radius_match.group(1), "in") / 2 if radius_match else 6.35

        sheet_thickness = 3.0
        half_back = back_length / 2
        left_side_center_z = left_length / 2
        right_side_center_z = right_length / 2
        wall_center_y = wall_height / 2
        slope_center_y = max(sheet_thickness * 2, wall_height * 0.18)
        top_hem_y = wall_height + sheet_thickness / 2

        elements = [
            self._line_with_three_d(
                [130, 128],
                [668, 170],
                "back wall top edge",
                {
                    "shape": "box",
                    "width": back_length,
                    "height": wall_height,
                    "depth": sheet_thickness,
                    "x": 0,
                    "y": wall_center_y,
                    "z": 0,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [130, 128],
                [92, 258],
                "left wall outer edge",
                {
                    "shape": "box",
                    "width": sheet_thickness,
                    "height": wall_height,
                    "depth": left_length,
                    "x": -half_back,
                    "y": wall_center_y,
                    "z": left_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [668, 170],
                [660, 312],
                "right wall outer edge",
                {
                    "shape": "box",
                    "width": sheet_thickness,
                    "height": wall_height,
                    "depth": right_length,
                    "x": half_back,
                    "y": wall_center_y,
                    "z": right_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [108, 255],
                [248, 212],
                "left 45 degree return",
                {
                    "shape": "box",
                    "width": slope_depth,
                    "height": sheet_thickness,
                    "depth": max(left_length - bend_radius, sheet_thickness * 2),
                    "x": -half_back + (slope_depth / 2),
                    "y": slope_center_y,
                    "z": left_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": -45,
                },
            ),
            self._line_with_three_d(
                [248, 212],
                [560, 236],
                "back 45 degree return",
                {
                    "shape": "box",
                    "width": max(back_length - (bend_radius * 2), sheet_thickness * 2),
                    "height": sheet_thickness,
                    "depth": slope_depth,
                    "x": 0,
                    "y": slope_center_y,
                    "z": slope_depth / 2,
                    "rotationX": -45,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [560, 236],
                [640, 192],
                "right 45 degree return",
                {
                    "shape": "box",
                    "width": slope_depth,
                    "height": sheet_thickness,
                    "depth": max(right_length - bend_radius, sheet_thickness * 2),
                    "x": half_back - (slope_depth / 2),
                    "y": slope_center_y,
                    "z": right_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 45,
                },
            ),
            self._line_with_three_d(
                [132, 128],
                [150, 98],
                "left top hem",
                {
                    "shape": "box",
                    "width": hem_size,
                    "height": sheet_thickness,
                    "depth": left_length,
                    "x": -half_back - (hem_size / 2),
                    "y": top_hem_y,
                    "z": left_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [150, 98],
                [612, 132],
                "back top hem",
                {
                    "shape": "box",
                    "width": back_length,
                    "height": sheet_thickness,
                    "depth": hem_size,
                    "x": 0,
                    "y": top_hem_y,
                    "z": -hem_size / 2,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
            self._line_with_three_d(
                [612, 132],
                [686, 112],
                "right top hem",
                {
                    "shape": "box",
                    "width": hem_size,
                    "height": sheet_thickness,
                    "depth": right_length,
                    "x": half_back + (hem_size / 2),
                    "y": top_hem_y,
                    "z": right_side_center_z,
                    "rotationX": 0,
                    "rotationY": 0,
                    "rotationZ": 0,
                },
            ),
        ]

        return {
            "elements": elements,
            "description": "3-sided sheet-metal channel with angled returns and folded top hems",
            "generation_id": str(uuid.uuid4()),
        }

    def _resolve_units(self, explicit_units: List[Optional[str]]) -> List[str]:
        resolved_units: List[str] = []
        active_unit = next((unit for unit in explicit_units if unit), "mm")

        for unit in explicit_units:
            if unit:
                active_unit = unit
            resolved_units.append(active_unit)

        return resolved_units

    def _build_primitive_from_prompt(self, prompt: str) -> Optional[Dict[str, Any]]:
        normalized_prompt = prompt.lower().replace("×", "x")
        box_keywords = ["box", "block", "cuboid", "rectangular prism", "rectangular block", "cube"]
        has_box_keyword = any(keyword in normalized_prompt for keyword in box_keywords)

        three_axis_match = re.search(
            r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*x\s*(\d+(?:\.\d+)?)\s*(mm|cm|m)?",
            normalized_prompt,
        )

        if three_axis_match and (has_box_keyword or "solid" in normalized_prompt or "3d" in normalized_prompt):
            values = [
                three_axis_match.group(1),
                three_axis_match.group(3),
                three_axis_match.group(5),
            ]
            explicit_units = [
                three_axis_match.group(2),
                three_axis_match.group(4),
                three_axis_match.group(6),
            ]
            resolved_units = self._resolve_units(explicit_units)
            width_mm, height_mm, depth_mm = [
                self._to_millimeters(value, unit)
                for value, unit in zip(values, resolved_units)
            ]

            if "cube" in normalized_prompt and len({round(width_mm, 4), round(height_mm, 4), round(depth_mm, 4)}) == 1:
                description = f"Solid {width_mm:g}mm cube"
            else:
                description = f"Solid {width_mm:g}mm x {height_mm:g}mm x {depth_mm:g}mm rectangular block"

            return self._build_centered_block(width_mm, height_mm, depth_mm, description)

        if "cube" in normalized_prompt:
            cube_match = re.search(r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:cube|side)", normalized_prompt)
            if cube_match:
                side_mm = self._to_millimeters(cube_match.group(1), cube_match.group(2))
                return self._build_centered_block(
                    side_mm,
                    side_mm,
                    side_mm,
                    f"Solid {side_mm:g}mm cube",
                )

        if "cylinder" in normalized_prompt:
            diameter_match = re.search(r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:diameter|dia)", normalized_prompt)
            radius_match = re.search(r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*radius", normalized_prompt)
            height_match = re.search(r"(\d+(?:\.\d+)?)\s*(mm|cm|m)?\s*(?:tall|high|height|deep)", normalized_prompt)

            if diameter_match and height_match:
                diameter_mm = self._to_millimeters(diameter_match.group(1), diameter_match.group(2))
                height_mm = self._to_millimeters(height_match.group(1), height_match.group(2))
                return self._build_centered_cylinder(
                    diameter_mm,
                    height_mm,
                    f"Solid cylinder with {diameter_mm:g}mm diameter and {height_mm:g}mm height",
                )

            if radius_match and height_match:
                radius_mm = self._to_millimeters(radius_match.group(1), radius_match.group(2))
                height_mm = self._to_millimeters(height_match.group(1), height_match.group(2))
                return self._build_centered_cylinder(
                    radius_mm * 2,
                    height_mm,
                    f"Solid cylinder with {radius_mm:g}mm radius and {height_mm:g}mm height",
                )

        return None
        
    async def text_to_cad(self, prompt: str) -> Dict[str, Any]:
        """
        Convert text description to CAD elements
        
        Args:
            prompt: User's text description of what to draw
            
        Returns:
            Dictionary with CAD elements and description
        """
        system_message = """You are an expert CAD designer. Convert user descriptions into CAD elements for an 800x600 canvas.

Return ONLY a JSON object with this structure:
{
    "description": "Brief description",
    "elements": [
        {
            "type": "line|rectangle|circle|polygon|text",
            "points": [[x1, y1], [x2, y2], ...],
            "properties": {
                "color": "#000000",
                "strokeWidth": 2,
                "depth": 10,
                "filled": false,
                "radius": 20,
                "text": "label",
                "label": "part name"
            }
        }
    ]
}

CRITICAL RULES:
1. For simple primitive solids (single box, block, cube, cylinder), use ONE solid element.
2. For detailed prompts (frames, furniture, rooms, layouts, assemblies, multi-part objects), use MULTIPLE logical elements.
3. Never collapse a detailed prompt into one giant bounding rectangle unless the user explicitly requests a wall, slab, panel, or block.
4. Every drawable element MUST include a numeric depth in millimeters.
5. Use realistic per-part depth values:
   - thin members/walls/legs/beams: usually 5-100mm
   - tabletops/panels/plates: usually 10-80mm
   - tall object height should usually be represented by multiple parts, not one oversized footprint extrusion
6. If the prompt describes a structure with legs, rails, openings, rooms, doors, windows, shelves, or posts, model those as separate elements.
7. Keep all geometry proportional and centered near the canvas.

GOOD EXAMPLES:
- "50mm x 30mm x 20mm block" -> one rectangle with depth 20
- "simple table with top and four legs" -> one tabletop rectangle + four leg rectangles, each with appropriate depth
- "room with door and window" -> multiple wall/door/window elements, not one solid box

Return valid JSON only. No markdown. No explanation."""
        
        primitive_result = self._build_primitive_from_prompt(prompt)
        if primitive_result:
            return primitive_result

        sheet_metal_result = self._build_sheet_metal_channel_from_prompt(prompt)
        if sheet_metal_result:
            return sheet_metal_result

        if not self.api_key:
            raise RuntimeError("EMERGENT_LLM_KEY is not configured")

        try:
            chat = LlmChat(
                api_key=self.api_key,
                session_id=f"text-to-cad-{uuid.uuid4()}",
                system_message=system_message
            ).with_model("openai", "gpt-5.1")
            
            user_message = UserMessage(text=prompt)
            response = await chat.send_message(user_message)
            
            # Parse the response
            try:
                # Clean the response - remove markdown code blocks if present
                cleaned_response = response.strip()
                if cleaned_response.startswith("```json"):
                    cleaned_response = cleaned_response[7:]
                if cleaned_response.startswith("```"):
                    cleaned_response = cleaned_response[3:]
                if cleaned_response.endswith("```"):
                    cleaned_response = cleaned_response[:-3]
                cleaned_response = cleaned_response.strip()
                
                cad_data = json.loads(cleaned_response)
                
                # Ensure all elements have depth property
                elements = cad_data.get("elements", [])
                for elem in elements:
                    if "depth" not in elem.get("properties", {}):
                        # Default to 10mm if not specified
                        if "properties" not in elem:
                            elem["properties"] = {}
                        elem["properties"]["depth"] = 10
                
                return {
                    "elements": elements,
                    "description": cad_data.get("description", "CAD drawing generated"),
                    "generation_id": str(uuid.uuid4())
                }
            except json.JSONDecodeError:
                # If JSON parsing fails, return a simple error shape
                return {
                    "elements": [
                        {
                            "type": "text",
                            "points": [[400, 300]],
                            "properties": {
                                "text": "Error parsing AI response. Try rephrasing your request.",
                                "color": "#FF0000",
                                "fontSize": 16,
                                "depth": 1
                            }
                        }
                    ],
                    "description": "Error generating CAD",
                    "generation_id": str(uuid.uuid4())
                }
                
        except Exception as e:
            print(f"Error in text_to_cad: {e}")
            raise
    
    async def image_to_cad(self, image_base64: str, instructions: Optional[str] = None) -> Dict[str, Any]:
        """
        Convert image to CAD elements by analyzing it
        
        Args:
            image_base64: Base64 encoded image
            instructions: Optional additional instructions
            
        Returns:
            Dictionary with CAD elements and description
        """
        system_message = """You are an expert CAD designer analyzing images. Your job is to carefully trace and extract geometric shapes, lines, and structures from hand-drawn sketches, photos, or blueprints.

CRITICAL INSTRUCTIONS FOR HAND DRAWINGS:
1. Look for ALL lines, even if rough or sketchy
2. Identify basic shapes: rectangles (rooms, boxes), lines (walls, edges), circles (holes, features)
3. Estimate dimensions proportionally - measure relative sizes in the image
4. Trace the main outlines and important features
5. Ignore minor imperfections but capture the intent
6. For architectural drawings: identify walls, doors, windows, rooms
7. For mechanical parts: identify edges, holes, fasteners, key dimensions

Return your response as a JSON object with this structure:
{
    "description": "Brief description of what was detected (be specific about what you found)",
    "elements": [
        {
            "type": "line|rectangle|circle|polygon|text",
            "points": [[x1, y1], [x2, y2], ...],
            "properties": {
                "color": "#hexcolor",
                "strokeWidth": number,
                "layer": "layer_name",
                "depth": number (in mm, default 10 for thin features, larger only for real solid parts),
                "filled": boolean,
                "radius": number (for circles),
                "text": "text content" (for annotations),
                "label": "description of this element (e.g., 'north wall', 'door', 'mounting hole')"
            }
        }
    ]
}

COORDINATE SYSTEM & SCALING:
- Use coordinate system: 0-800 for x, 0-600 for y (canvas size)
- Analyze the image dimensions and scale proportionally
- If image shows a 20ft room, map it to the canvas proportionally
- Maintain aspect ratios from the original drawing

ELEMENT TYPES:
- line: needs 2 points [[x1,y1], [x2,y2]] - use for walls, edges, lines
- rectangle: needs 2 points [[x1,y1], [x2,y2]] for corners - use for rooms, boxes, features
- circle: needs 1 center point [[x,y]] and radius in properties - use for holes, circular features
- polygon: needs multiple points - use for irregular shapes
- text: needs 1 point [[x,y]] and "text" in properties - use for labels and dimensions

COLOR CODING (use appropriate colors):
- Main structure/walls: #000000 (black)
- Doors/openings: #0000FF (blue)  
- Windows: #00FFFF (cyan)
- Dimensions/annotations: #FF0000 (red)
- Secondary features: #00FF00 (green)

IMPORTANT: 
- Return ONLY the JSON object, no additional text
- Extract AS MANY elements as you can identify in the drawing
- Be generous with detection - if it looks like a line or shape, include it
- Add descriptive labels to help user understand what each element represents
- Every drawable element must include a numeric depth value
- Only use large depth values when the image clearly represents a true solid part"""
        
        try:
            chat = LlmChat(
                api_key=self.api_key,
                session_id=f"image-to-cad-{uuid.uuid4()}",
                system_message=system_message
            ).with_model("openai", "gpt-5.1")
            
            # Create image content
            image_content = ImageContent(image_base64=image_base64)
            
            # Create prompt
            prompt_text = "Analyze this image and convert it to CAD elements."
            if instructions:
                prompt_text += f" Additional instructions: {instructions}"
            
            user_message = UserMessage(
                text=prompt_text,
                file_contents=[image_content]
            )
            
            response = await chat.send_message(user_message)
            
            # Parse the response
            try:
                # Clean the response
                cleaned_response = response.strip()
                if cleaned_response.startswith("```json"):
                    cleaned_response = cleaned_response[7:]
                if cleaned_response.startswith("```"):
                    cleaned_response = cleaned_response[3:]
                if cleaned_response.endswith("```"):
                    cleaned_response = cleaned_response[:-3]
                cleaned_response = cleaned_response.strip()
                
                cad_data = json.loads(cleaned_response)
                elements = cad_data.get("elements", [])

                for elem in elements:
                    if "properties" not in elem:
                        elem["properties"] = {}
                    if "depth" not in elem.get("properties", {}):
                        elem["properties"]["depth"] = 10
                    if "filled" not in elem.get("properties", {}):
                        elem["properties"]["filled"] = elem.get("type") in {"rectangle", "circle", "polygon"}

                return {
                    "elements": elements,
                    "description": cad_data.get("description", "CAD drawing from image"),
                    "generation_id": str(uuid.uuid4())
                }
            except json.JSONDecodeError:
                return {
                    "elements": [
                        {
                            "type": "text",
                            "points": [[400, 300]],
                            "properties": {
                                "text": "Error parsing image. Please try a clearer image.",
                                "color": "#FF0000",
                                "fontSize": 16
                            }
                        }
                    ],
                    "description": "Error analyzing image",
                    "generation_id": str(uuid.uuid4())
                }
                
        except Exception as e:
            print(f"Error in image_to_cad: {e}")
            raise
