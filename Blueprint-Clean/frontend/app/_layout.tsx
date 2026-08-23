import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import React from 'react';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="path" />
        <Stack.Screen name="upgrade" />
      </Stack>
    </AuthProvider>
  );
}

