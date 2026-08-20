from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
from datetime import datetime

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str



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
    visitor_id: Optional[str] = None
    source: Optional[str] = None
    medium: Optional[str] = None
    campaign: Optional[str] = None


class CreateCheckoutSessionResponse(BaseModel):
    url: str
    session_id: str


class SvgSubscriptionQuoteRequest(BaseModel):
    selected_product_ids: List[str]


class SvgSubscriptionLineItem(BaseModel):
    product_id: str
    name: str
    unit_amount_cents: int


class SvgSubscriptionQuoteResponse(BaseModel):
    currency: str
    interval: str
    selected_product_ids: List[str]
    tool_count: int
    unit_amount_cents: int
    subtotal_cents: int
    discount_percent: int
    discount_cents: int
    total_cents: int
    line_items: List[SvgSubscriptionLineItem]


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
