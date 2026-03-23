#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for AI-Powered CAD Blueprint API
Tests all backend endpoints including authentication, AI generation, and CRUD operations.
"""

import asyncio
import aiohttp
import json
import base64
import uuid
from datetime import datetime
from typing import Dict, Any, Optional
import os

# Get backend URL from frontend .env file
BACKEND_URL = "https://blueprint-ai-44.preview.emergentagent.com/api"

class CADAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.session = None
        self.auth_token = None
        self.test_user_email = f"testuser_{uuid.uuid4().hex[:8]}@example.com"
        self.test_user_username = f"testuser_{uuid.uuid4().hex[:8]}"
        self.test_user_password = "SecurePassword123!"
        self.created_blueprint_id = None
        self.test_results = []
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    def log_result(self, test_name: str, success: bool, message: str, details: Any = None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "message": message,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    async def make_request(self, method: str, endpoint: str, data: Dict = None, 
                          headers: Dict = None, auth_required: bool = False) -> tuple:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        
        # Set up headers
        request_headers = {"Content-Type": "application/json"}
        if headers:
            request_headers.update(headers)
        
        # Add auth token if required
        if auth_required and self.auth_token:
            request_headers["Authorization"] = f"Bearer {self.auth_token}"
        
        try:
            async with self.session.request(
                method, url, 
                json=data if data else None,
                headers=request_headers,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                try:
                    response_data = await response.json()
                except:
                    response_data = await response.text()
                
                return response.status, response_data
                
        except Exception as e:
            return 0, {"error": str(e)}
    
    async def test_health_check(self):
        """Test basic health check endpoint"""
        status, data = await self.make_request("GET", "/health")
        
        if status == 200 and isinstance(data, dict) and data.get("status") == "healthy":
            self.log_result("Health Check", True, "API is healthy and responding")
        else:
            self.log_result("Health Check", False, f"Health check failed", {"status": status, "data": data})
    
    async def test_register_user(self):
        """Test user registration"""
        user_data = {
            "email": self.test_user_email,
            "username": self.test_user_username,
            "password": self.test_user_password
        }
        
        status, data = await self.make_request("POST", "/auth/register", user_data)
        
        if status == 200 and isinstance(data, dict):
            if "access_token" in data and "user" in data:
                self.auth_token = data["access_token"]
                self.log_result("User Registration", True, f"User registered successfully: {data['user']['email']}")
                return True
            else:
                self.log_result("User Registration", False, "Missing token or user data in response", data)
        else:
            self.log_result("User Registration", False, f"Registration failed with status {status}", data)
        
        return False
    
    async def test_login_user(self):
        """Test user login"""
        login_data = {
            "email": self.test_user_email,
            "password": self.test_user_password
        }
        
        status, data = await self.make_request("POST", "/auth/login", login_data)
        
        if status == 200 and isinstance(data, dict):
            if "access_token" in data and "user" in data:
                self.auth_token = data["access_token"]
                self.log_result("User Login", True, f"Login successful for: {data['user']['email']}")
                return True
            else:
                self.log_result("User Login", False, "Missing token or user data in response", data)
        else:
            self.log_result("User Login", False, f"Login failed with status {status}", data)
        
        return False
    
    async def test_invalid_login(self):
        """Test login with invalid credentials"""
        login_data = {
            "email": self.test_user_email,
            "password": "wrongpassword"
        }
        
        status, data = await self.make_request("POST", "/auth/login", login_data)
        
        if status == 401:
            self.log_result("Invalid Login Test", True, "Correctly rejected invalid credentials")
        else:
            self.log_result("Invalid Login Test", False, f"Should have returned 401, got {status}", data)
    
    async def test_get_current_user(self):
        """Test getting current user info"""
        if not self.auth_token:
            self.log_result("Get Current User", False, "No auth token available")
            return
        
        status, data = await self.make_request("GET", "/auth/me", auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "email" in data and "username" in data:
                self.log_result("Get Current User", True, f"Retrieved user info: {data['email']}")
            else:
                self.log_result("Get Current User", False, "Missing user data fields", data)
        else:
            self.log_result("Get Current User", False, f"Failed to get user info, status {status}", data)
    
    async def test_text_to_cad_guest(self):
        """Test text-to-CAD generation as guest user"""
        prompt_data = {
            "prompt": "Create a simple 10x10 room with a door on the north wall"
        }
        
        status, data = await self.make_request("POST", "/ai/text-to-cad", prompt_data)
        
        if status == 200 and isinstance(data, dict):
            if "elements" in data and "description" in data and "generation_id" in data:
                elements = data["elements"]
                if isinstance(elements, list) and len(elements) > 0:
                    self.log_result("Text-to-CAD (Guest)", True, f"Generated {len(elements)} CAD elements: {data['description']}")
                else:
                    self.log_result("Text-to-CAD (Guest)", False, "No CAD elements generated", data)
            else:
                self.log_result("Text-to-CAD (Guest)", False, "Missing required response fields", data)
        else:
            self.log_result("Text-to-CAD (Guest)", False, f"Text-to-CAD failed with status {status}", data)
    
    async def test_text_to_cad_authenticated(self):
        """Test text-to-CAD generation as authenticated user"""
        if not self.auth_token:
            self.log_result("Text-to-CAD (Auth)", False, "No auth token available")
            return
        
        prompt_data = {
            "prompt": "Create a simple office layout with desk, chair, and window"
        }
        
        status, data = await self.make_request("POST", "/ai/text-to-cad", prompt_data, auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "elements" in data and "description" in data and "generation_id" in data:
                elements = data["elements"]
                if isinstance(elements, list) and len(elements) > 0:
                    self.log_result("Text-to-CAD (Auth)", True, f"Generated {len(elements)} CAD elements: {data['description']}")
                else:
                    self.log_result("Text-to-CAD (Auth)", False, "No CAD elements generated", data)
            else:
                self.log_result("Text-to-CAD (Auth)", False, "Missing required response fields", data)
        else:
            self.log_result("Text-to-CAD (Auth)", False, f"Text-to-CAD failed with status {status}", data)
    
    def create_test_image_base64(self) -> str:
        """Create a simple test image in base64 format"""
        # Create a simple 100x100 red rectangle as base64
        # This is a minimal PNG image data
        png_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00d\x00\x00\x00d\x08\x02\x00\x00\x00\xff\x80\x02\x03\x00\x00\x00\x19tEXtSoftware\x00Adobe ImageReadyq\xc9e<\x00\x00\x00\x0eIDATx\xdac\xf8\x0f\x00\x00\x01\x00\x01\x00\x00\x00\x00IEND\xaeB`\x82'
        return base64.b64encode(png_data).decode('utf-8')
    
    async def test_image_to_cad_guest(self):
        """Test image-to-CAD generation as guest user"""
        test_image = self.create_test_image_base64()
        
        image_data = {
            "image_base64": test_image,
            "instructions": "Convert this simple shape to CAD elements"
        }
        
        status, data = await self.make_request("POST", "/ai/image-to-cad", image_data)
        
        if status == 200 and isinstance(data, dict):
            if "elements" in data and "description" in data and "generation_id" in data:
                elements = data["elements"]
                if isinstance(elements, list) and len(elements) > 0:
                    self.log_result("Image-to-CAD (Guest)", True, f"Generated {len(elements)} CAD elements: {data['description']}")
                else:
                    self.log_result("Image-to-CAD (Guest)", False, "No CAD elements generated", data)
            else:
                self.log_result("Image-to-CAD (Guest)", False, "Missing required response fields", data)
        else:
            self.log_result("Image-to-CAD (Guest)", False, f"Image-to-CAD failed with status {status}", data)
    
    async def test_image_to_cad_authenticated(self):
        """Test image-to-CAD generation as authenticated user"""
        if not self.auth_token:
            self.log_result("Image-to-CAD (Auth)", False, "No auth token available")
            return
        
        test_image = self.create_test_image_base64()
        
        image_data = {
            "image_base64": test_image,
            "instructions": "Analyze this image and create CAD elements"
        }
        
        status, data = await self.make_request("POST", "/ai/image-to-cad", image_data, auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "elements" in data and "description" in data and "generation_id" in data:
                elements = data["elements"]
                if isinstance(elements, list) and len(elements) > 0:
                    self.log_result("Image-to-CAD (Auth)", True, f"Generated {len(elements)} CAD elements: {data['description']}")
                else:
                    self.log_result("Image-to-CAD (Auth)", False, "No CAD elements generated", data)
            else:
                self.log_result("Image-to-CAD (Auth)", False, "Missing required response fields", data)
        else:
            self.log_result("Image-to-CAD (Auth)", False, f"Image-to-CAD failed with status {status}", data)
    
    async def test_create_blueprint(self):
        """Test creating a new blueprint"""
        if not self.auth_token:
            self.log_result("Create Blueprint", False, "No auth token available")
            return
        
        blueprint_data = {
            "name": "Test Blueprint",
            "description": "A test blueprint created during API testing",
            "elements": [
                {
                    "type": "rectangle",
                    "points": [[100, 100], [300, 200]],
                    "properties": {
                        "color": "#000000",
                        "strokeWidth": 2,
                        "filled": False
                    }
                },
                {
                    "type": "line",
                    "points": [[100, 100], [300, 100]],
                    "properties": {
                        "color": "#0000FF",
                        "strokeWidth": 1
                    }
                }
            ],
            "tags": ["test", "api", "blueprint"]
        }
        
        status, data = await self.make_request("POST", "/blueprints", blueprint_data, auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "id" in data and "name" in data and "elements" in data:
                self.created_blueprint_id = data["id"]
                self.log_result("Create Blueprint", True, f"Blueprint created with ID: {data['id']}")
            else:
                self.log_result("Create Blueprint", False, "Missing required response fields", data)
        else:
            self.log_result("Create Blueprint", False, f"Blueprint creation failed with status {status}", data)
    
    async def test_get_blueprints(self):
        """Test getting all blueprints for user"""
        if not self.auth_token:
            self.log_result("Get Blueprints", False, "No auth token available")
            return
        
        status, data = await self.make_request("GET", "/blueprints", auth_required=True)
        
        if status == 200 and isinstance(data, list):
            self.log_result("Get Blueprints", True, f"Retrieved {len(data)} blueprints")
        else:
            self.log_result("Get Blueprints", False, f"Failed to get blueprints, status {status}", data)
    
    async def test_get_specific_blueprint(self):
        """Test getting a specific blueprint"""
        if not self.auth_token or not self.created_blueprint_id:
            self.log_result("Get Specific Blueprint", False, "No auth token or blueprint ID available")
            return
        
        status, data = await self.make_request("GET", f"/blueprints/{self.created_blueprint_id}", auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "id" in data and "name" in data and "elements" in data:
                self.log_result("Get Specific Blueprint", True, f"Retrieved blueprint: {data['name']}")
            else:
                self.log_result("Get Specific Blueprint", False, "Missing required response fields", data)
        else:
            self.log_result("Get Specific Blueprint", False, f"Failed to get blueprint, status {status}", data)
    
    async def test_update_blueprint(self):
        """Test updating a blueprint"""
        if not self.auth_token or not self.created_blueprint_id:
            self.log_result("Update Blueprint", False, "No auth token or blueprint ID available")
            return
        
        update_data = {
            "name": "Updated Test Blueprint",
            "description": "Updated description for testing",
            "tags": ["updated", "test", "api"]
        }
        
        status, data = await self.make_request("PUT", f"/blueprints/{self.created_blueprint_id}", update_data, auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if data.get("name") == "Updated Test Blueprint":
                self.log_result("Update Blueprint", True, f"Blueprint updated successfully")
            else:
                self.log_result("Update Blueprint", False, "Blueprint not updated correctly", data)
        else:
            self.log_result("Update Blueprint", False, f"Blueprint update failed with status {status}", data)
    
    async def test_premium_activation(self):
        """Test premium activation with bypass code"""
        if not self.auth_token:
            self.log_result("Premium Activation", False, "No auth token available")
            return
        
        # Test with correct code
        status, data = await self.make_request("POST", "/premium/activate?code=CAD_PREMIUM_2025", auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if data.get("is_premium") == True:
                self.log_result("Premium Activation", True, "Premium activated successfully")
            else:
                self.log_result("Premium Activation", False, "Premium not activated correctly", data)
        else:
            self.log_result("Premium Activation", False, f"Premium activation failed with status {status}", data)
        
        # Test with invalid code
        status, data = await self.make_request("POST", "/premium/activate?code=INVALID_CODE", auth_required=True)
        
        if status == 400:
            self.log_result("Premium Invalid Code Test", True, "Correctly rejected invalid premium code")
        else:
            self.log_result("Premium Invalid Code Test", False, f"Should have returned 400, got {status}", data)
    
    async def test_delete_blueprint(self):
        """Test deleting a blueprint"""
        if not self.auth_token or not self.created_blueprint_id:
            self.log_result("Delete Blueprint", False, "No auth token or blueprint ID available")
            return
        
        status, data = await self.make_request("DELETE", f"/blueprints/{self.created_blueprint_id}", auth_required=True)
        
        if status == 200 and isinstance(data, dict):
            if "message" in data:
                self.log_result("Delete Blueprint", True, "Blueprint deleted successfully")
            else:
                self.log_result("Delete Blueprint", False, "Unexpected response format", data)
        else:
            self.log_result("Delete Blueprint", False, f"Blueprint deletion failed with status {status}", data)
    
    async def run_all_tests(self):
        """Run all API tests in sequence"""
        print(f"\n🚀 Starting CAD API Backend Tests")
        print(f"Backend URL: {self.base_url}")
        print(f"Test User: {self.test_user_email}")
        print("=" * 60)
        
        # Health check
        await self.test_health_check()
        
        # Authentication tests
        await self.test_register_user()
        await self.test_login_user()
        await self.test_invalid_login()
        await self.test_get_current_user()
        
        # AI generation tests
        await self.test_text_to_cad_guest()
        await self.test_text_to_cad_authenticated()
        await self.test_image_to_cad_guest()
        await self.test_image_to_cad_authenticated()
        
        # Blueprint CRUD tests
        await self.test_create_blueprint()
        await self.test_get_blueprints()
        await self.test_get_specific_blueprint()
        await self.test_update_blueprint()
        
        # Premium tests
        await self.test_premium_activation()
        
        # Cleanup
        await self.test_delete_blueprint()
        
        # Summary
        self.print_summary()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("🏁 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results if result["success"])
        failed = len(self.test_results) - passed
        
        print(f"Total Tests: {len(self.test_results)}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"Success Rate: {(passed/len(self.test_results)*100):.1f}%")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['test']}: {result['message']}")
        
        print("\n" + "=" * 60)


async def main():
    """Main test runner"""
    async with CADAPITester() as tester:
        await tester.run_all_tests()


if __name__ == "__main__":
    asyncio.run(main())