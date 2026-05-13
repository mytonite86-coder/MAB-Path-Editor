import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import React from 'react';
import { Platform } from 'react-native';
//import Purchases from 'react-native-purchases';
import { useEffect } from 'react';

export default function RootLayout() {
  // RevenueCat temporarily disabled to test startup crash
  // useEffect(() => {
  //   if (Platform.OS === 'android') {
  //     Purchases.configure({
  //       apiKey: 'goog_cVhPtyrQIGTYinFbrQLRdPNRayp',
  //     });
  //   }
  // }, []);

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