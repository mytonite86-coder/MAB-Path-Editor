from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    is_premium: bool
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class CADElement(BaseModel):
    """Represents a single CAD element (line, rectangle, circle, etc.)"""
    type: str  # 'line', 'rectangle', 'circle', 'polygon', 'text'
    points: List[List[float]]  # Array of [x, y] coordinates
    properties: Dict[str, Any] = {}  # color, strokeWidth, layer, etc.


class BlueprintCreate(BaseModel):
    name: str
    description: Optional[str] = None
    elements: List[CADElement] = []
    thumbnail: Optional[str] = None  # base64 image
    tags: List[str] = []


class BlueprintUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    elements: Optional[List[CADElement]] = None
    thumbnail: Optional[str] = None
    tags: Optional[List[str]] = None


class BlueprintResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str] = None
    elements: List[CADElement]
    thumbnail: Optional[str] = None
    tags: List[str]
    created_at: datetime
    updated_at: datetime


class TextToCADRequest(BaseModel):
    prompt: str
    user_id: Optional[str] = None  # Optional for guest users


class ImageToCADRequest(BaseModel):
    image_base64: str
    instructions: Optional[str] = None
    user_id: Optional[str] = None  # Optional for guest users


class AICADResponse(BaseModel):
    elements: List[CADElement]
    description: str
    generation_id: str


class ExportRequest(BaseModel):
    blueprint_id: Optional[str] = None
    elements: List[CADElement]
    format: str  # 'png', 'pdf', 'dxf'
    width: int = 800
    height: int = 600


class PaymentPackageResponse(BaseModel):
    package_id: str
    name: str
    description: str
    amount: float
    currency: str
    perks: List[str] = []


class CreateCheckoutSessionRequest(BaseModel):
    package_id: str
    origin_url: str


class CreateCheckoutSessionResponse(BaseModel):
    url: str
    session_id: str


class PaymentStatusResponse(BaseModel):
    session_id: str
    package_id: str
    status: str
    payment_status: str
    amount_total: int
    currency: str
    is_premium: bool
