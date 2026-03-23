#!/usr/bin/env python3
"""
Test Image-to-CAD functionality with a proper test image
"""

import asyncio
import aiohttp
import base64
from PIL import Image
import io

BACKEND_URL = "https://blueprint-ai-44.preview.emergentagent.com/api"

def create_proper_test_image():
    """Create a proper test image using PIL"""
    # Create a simple 100x100 image with a red rectangle
    img = Image.new('RGB', (100, 100), color='white')
    
    # Draw a simple red rectangle
    from PIL import ImageDraw
    draw = ImageDraw.Draw(img)
    draw.rectangle([20, 20, 80, 80], fill='red', outline='black', width=2)
    
    # Convert to base64
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    img_data = buffer.getvalue()
    
    return base64.b64encode(img_data).decode('utf-8')

async def test_image_to_cad():
    """Test image-to-CAD with proper image"""
    test_image = create_proper_test_image()
    
    image_data = {
        "image_base64": test_image,
        "instructions": "Convert this red rectangle to CAD elements"
    }
    
    async with aiohttp.ClientSession() as session:
        url = f"{BACKEND_URL}/ai/image-to-cad"
        headers = {"Content-Type": "application/json"}
        
        try:
            async with session.post(url, json=image_data, headers=headers, timeout=aiohttp.ClientTimeout(total=60)) as response:
                status = response.status
                try:
                    data = await response.json()
                except:
                    data = await response.text()
                
                print(f"Status: {status}")
                print(f"Response: {data}")
                
                if status == 200 and isinstance(data, dict):
                    if "elements" in data and "description" in data:
                        elements = data["elements"]
                        print(f"✅ SUCCESS: Generated {len(elements)} CAD elements")
                        print(f"Description: {data['description']}")
                        return True
                    else:
                        print("❌ FAIL: Missing required response fields")
                else:
                    print(f"❌ FAIL: Request failed with status {status}")
                    
        except Exception as e:
            print(f"❌ ERROR: {e}")
    
    return False

if __name__ == "__main__":
    print("Testing Image-to-CAD with proper image format...")
    asyncio.run(test_image_to_cad())