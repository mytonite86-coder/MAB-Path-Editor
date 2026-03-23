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
        system_message = """You are an expert CAD designer. Convert user descriptions into precise CAD elements.
        
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
                        "text": "text content" (for text elements)
                    }
                }
            ]
        }
        
        Guidelines:
        - Use coordinate system: 0-800 for x, 0-600 for y (center is 400, 300)
        - line: needs 2 points [[x1,y1], [x2,y2]]
        - rectangle: needs 2 points [[x1,y1], [x2,y2]] for top-left and bottom-right corners
        - circle: needs 1 center point [[x,y]] and radius in properties
        - polygon: needs multiple points [[x1,y1], [x2,y2], [x3,y3], ...]
        - text: needs 1 point [[x,y]] for position and "text" in properties
        - Default colors: walls/main lines: #000000, dimensions: #0000FF, annotations: #FF0000
        - Default strokeWidth: 2 for main elements, 1 for annotations
        - Create proper architectural/technical drawings with accurate proportions
        
        IMPORTANT: Return ONLY the JSON object, no additional text or explanation."""
        
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
                return {
                    "elements": cad_data.get("elements", []),
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
                                "fontSize": 16
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
        system_message = """You are an expert CAD designer analyzing images. Extract lines, shapes, and structures from the image and convert them to CAD elements.
        
        Return your response as a JSON object with this structure:
        {
            "description": "Brief description of what was detected in the image",
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
                        "text": "text content" (for text)
                    }
                }
            ]
        }
        
        Guidelines:
        - Analyze the image and extract geometric shapes, lines, and structures
        - Use coordinate system: 0-800 for x, 0-600 for y
        - Trace edges, detect shapes, and recreate them as CAD elements
        - Maintain proportions from the original image
        - Use appropriate colors based on the image content
        - Add text annotations for labels found in the image
        
        IMPORTANT: Return ONLY the JSON object, no additional text or explanation."""
        
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
