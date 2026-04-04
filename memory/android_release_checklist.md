# Android Release Final Checklist

## Must replace before public launch
- `backend/.env` -> set a **production** `JWT_SECRET`
- `backend/.env` -> set your **real production** `STRIPE_API_KEY`
- `backend/.env` -> point `MONGO_URL` and `DB_NAME` at production data
- `frontend/.env` -> set `EXPO_PUBLIC_BACKEND_URL` to your final backend URL

## Build config already prepared
- App name: `CAD Blueprint`
- Slug: `cad-blueprint`
- Android package: `com.cadblueprint.app`
- Deep link scheme: `cadblueprint://`
- `eas.json` added for preview APK and production AAB builds

## Final manual steps
1. Replace the env values above
2. Build preview APK: `eas build --platform android --profile preview`
3. Test install on a real Android device
4. Build Play Store bundle: `eas build --platform android --profile production`
5. Upload AAB to Play Console internal testing first
6. Complete store listing, privacy policy, and content declarations
7. Promote after internal test passes