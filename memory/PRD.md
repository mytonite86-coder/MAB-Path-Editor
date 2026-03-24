# AI CAD Mobile App PRD

## Problem Statement
Build an Expo-based AI-powered mobile CAD application for blueprint creation with:
- text-to-CAD generation
- image-to-CAD generation
- 2D editing
- 3D viewing/analysis
- JWT auth and blueprint saving
- guest/authenticated/premium tier behavior

## Architecture
- **Frontend:** Expo / React Native / expo-router / react-native-svg / expo-gl / expo-three / three
- **Backend:** FastAPI + Motor + JWT auth
- **Database:** MongoDB
- **AI:** OpenAI GPT-5.1 via Emergent universal LLM key

## Implemented
- JWT auth with register/login/current-user flow
- Guest mode and premium bypass flow
- 2D CAD canvas with draw/select/move/delete basics
- Text-to-CAD and Image-to-CAD integration
- Blueprint save/load/delete for authenticated users
- 3D viewer with engineering analysis
- Canvas scroll/draw conflict fix from earlier session
- **Validated fix:** solid primitive prompts now generate deterministic single solid elements before LLM fallback
- **Validated fix:** 3D viewer now renders route-provided elements correctly instead of mounting an empty scene first
- AI-generated elements now normalize IDs/depth for editing and 3D usage
- Critical auth/canvas/viewer/home controls now include testIDs
- Image-picker permissions added to app config

## Current Validated Status
- Text prompt `Create a solid 50mm x 30mm x 20mm rectangular block` returns one rectangle with `depth: 20`
- Text prompt `Create a 40mm diameter x 60mm tall cylinder` returns one circle with `radius: 20` and `depth: 60`
- Viewer route renders a visible solid block and preserves 20mm depth in UI
- Auth screen regression from invalid icon is fixed
- No MOCKED APIs in the validated scope

## Backlog

### P0
- Validate real-device user flow for text-to-3D on the user’s own prompts/sketches
- Improve Image-to-CAD quality specifically for rough hand drawings
- Continue breaking down oversized `frontend/app/canvas.tsx` into smaller components

### P1
- Stripe premium payments
- Export formats for 2D/3D assets (PDF/DXF/STL/OBJ)
- Additional E2E coverage for save/load/edit flows after AI generation

### P2
- Multi-view drawing (top/front/side)
- Isometric drawing view
- More CAD tools: polygons, text annotations, dimensions