import { AuthProvider } from "../context/AuthContext";
import { Stack } from "expo-router";

export default function Layout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="home" />
        <Stack.Screen name="canvas" />
        <Stack.Screen name="gallery" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="viewer3d" />
      </Stack>
    </AuthProvider>
  );
}