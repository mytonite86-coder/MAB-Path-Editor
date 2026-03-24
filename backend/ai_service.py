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
        system_message = """You are an expert 3D CAD designer. Convert user descriptions into precise 3D CAD elements.
        
        Return your response as a JSON object with this structure:
        {
            "description": "Brief description of what was created",
            "elements": [
                {
                    "type": "line|rectangle|circle|polygon|text",
                    "points": [[x1, y1], [x2, y2], ...],
                    "properties": {
                        "color": "#hexcolor",
                        "strokeWidth": number,
                        "layer": "layer_name",
                        "filled": boolean (for shapes),
                        "radius": number (for circles),
                        "text": "text content" (for text elements),
                        "depth": number (REQUIRED - depth in mm for 3D extrusion)
                    }
                }
            ]
        }
        
        CRITICAL 3D INSTRUCTIONS:
        - EVERY element MUST have a "depth" property in mm
        - Think in 3D! For a cube/box, you need faces with appropriate depths
        - For a 10x10x10mm cube: create rectangles representing walls with proper depths
        - For hollow objects: use thin depths for walls (e.g., 2mm)
        - For solid objects: use the full dimension as depth
        - Example cube 20x20x20mm:
          * Bottom: 20x20 rectangle, depth: 20mm (the full height)
          * OR create 6 faces: bottom (depth 2mm), 4 walls (depth 2mm), top (depth 2mm)
        
        Guidelines:
        - Use coordinate system: 0-800 for x, 0-600 for y (center is 400, 300)
        - line: needs 2 points [[x1,y1], [x2,y2]], depth in mm
        - rectangle: needs 2 points [[x1,y1], [x2,y2]] for corners, depth for height
        - circle: needs 1 center point [[x,y]], radius, and depth for cylinder height
        - polygon: needs multiple points, depth for extrusion
        - text: needs 1 point [[x,y]], "text" in properties, depth for 3D text
        
        - Default colors: walls/main: #000000, dimensions: #0000FF, annotations: #FF0000
        - Default strokeWidth: 2 for main elements, 1 for annotations
        - Create proper 3D structures with accurate proportions
        
        IMPORTANT: 
        - ALWAYS specify depth for each element based on the 3D object being created
        - For a "10mm cube", use depth: 10 for the main body
        - For hollow structures, use appropriate wall thickness (2-5mm typically)
        - Return ONLY the JSON object, no additional text or explanation."""
        
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
