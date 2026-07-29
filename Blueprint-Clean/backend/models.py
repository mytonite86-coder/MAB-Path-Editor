from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime


class UserResponse(BaseModel):
    id: str
    email: str
    username: str
    is_premium: bool
    entitlements: List[str] = Field(default_factory=list)
    created_at: datetime


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











class ExportRequest(BaseModel):
    blueprint_id: Optional[str] = None
    elements: List[CADElement]
    format: str  # 'png', 'pdf', 'dxf'
    width: int = 800
    height: int = 600


class PaymentPackageResponse(BaseModel):
    package_id: str
    product_id: str = ""
    name: str
    description: str
    amount: float
    currency: str
    billing_mode: str = "payment"
    interval: Optional[str] = None
    perks: List[str] = Field(default_factory=list)


class CreateCheckoutSessionRequest(BaseModel):
    package_id: str
    origin_url: str


class CreateCheckoutSessionResponse(BaseModel):
    url: str
    session_id: str


class PaymentStatusResponse(BaseModel):
    session_id: str
    package_id: str
    product_id: str = ""
    status: str
    payment_status: str
    amount_total: int
    currency: str
    is_premium: bool
    entitlements: List[str] = Field(default_factory=list)
    subscription_status: Optional[str] = None
