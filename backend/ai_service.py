from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from typing import List, Dict, Any, Optional
import json
import os
import uuid
from dotenv import load_dotenv

load_dotenv()

EMERGENT_LLM_KEY = os.getenv("EMERGENT_LLM_KEY")


class AICADService:
    """Service for AI-powered CAD generation using GPT-5.1"""
    
    def __init__(self):
        self.api_key = EMERGENT_LLM_KEY
        
    async def text_to_cad(self, prompt: str) -> Dict[str, Any]:
        """
        Convert text description to CAD elements
        
        Args:
            prompt: User's text description of what to draw
            
        Returns:
            Dictionary with CAD elements and description
        """
        system_message = """You are an expert 3D CAD designer. Convert user descriptions into a SINGLE solid 3D object.

CRITICAL: For any 3D object (box, cube, cylinder), create ONE element that represents the entire solid object.

Return your response as a JSON object:
{
    "description": "Brief description",
    "elements": [
        {
            "type": "rectangle" (for boxes/cubes) or "circle" (for cylinders),
            "points": [[x1, y1], [x2, y2]] for rectangle center, or [[x, y]] for circle center,
            "properties": {
                "color": "#000000",
                "strokeWidth": 2,
                "depth": THE_FULL_HEIGHT_IN_MM,
                "filled": true
            }
        }
    ]
}

EXAMPLES:
- "50mm x 30mm x 20mm block":
  * ONE rectangle: width=50, height=30 in 2D
  * depth=20 (the FULL 20mm height)
  * Points: [[375, 285], [425, 315]] (centered at 400,300)

- "40mm diameter x 60mm tall cylinder":
  * ONE circle: radius=20
  * depth=60 (the FULL 60mm height)
  * Points: [[400, 300]]

COORDINATE SYSTEM: Canvas is 800x600, center at (400, 300)

DO NOT create multiple faces or walls - create ONE solid element with its full depth.
Return ONLY valid JSON, no markdown or explanation."""
        
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
            except json.JSONDecodeError as e:
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
- Add descriptive labels to help user understand what each element represents"""
        
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
                return {
                    "elements": cad_data.get("elements", []),
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
