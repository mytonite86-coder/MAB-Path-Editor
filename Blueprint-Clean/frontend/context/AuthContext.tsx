import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';
import { Platform } from "react-native";
import { API_URL } from '@/config/api';
import { reconcileCheckoutReturn } from '../utils/checkoutReturn';

interface User {
  id: string;
  email: string;
  username: string;
  is_premium: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isGuest: boolean;
  isPro: boolean;
  checkoutMessage: string;
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web' || isLoading || typeof window === 'undefined') return;
    const query = new URLSearchParams(window.location.search);
    const returned = query.get('checkout');
    if (returned !== 'success' && returned !== 'cancel') return;
    let current = true;
    setIsPro(false);
    if (!token) { setCheckoutMessage('Sign in again to check your access. Demo restrictions remain.'); return; }
    setCheckoutMessage('Checking your M.A.B. access…');
    reconcileCheckoutReturn(API_URL, token, returned === 'success' ? query.get('session_id') : null)
      .then(fresh => {
        if (!current) return;
        setUser(fresh);
        setIsPro(fresh.is_premium === true);
        window.sessionStorage.setItem('user', JSON.stringify(fresh));
        setCheckoutMessage(fresh.is_premium ? 'Premium access confirmed. Copy and export are unlocked.' : 'No premium access confirmed. Demo restrictions remain. Reload after payment completes to check again.');
      })
      .catch(error => { if (current) setCheckoutMessage(error instanceof Error ? error.message : 'Access check failed. Demo restrictions remain.'); });
    return () => { current = false; };
  }, [token, isLoading]);

  useEffect(() => {
    // Load stored auth data on mount
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
  try {
    setIsGuest(false);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // Remove old permanently saved browser logins.
      await AsyncStorage.removeItem('authToken');
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('guestMode');

      // Keep login only for the current browser tab/session.
      const storedToken = window.sessionStorage.getItem('authToken');
      const storedUser = window.sessionStorage.getItem('user');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } else {
        setToken(null);
        setUser(null);
      }

      return;
    }

    const storedToken = await AsyncStorage.getItem('authToken');
    const storedUser = await AsyncStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
    }
  } catch (error) {
    console.error('Error loading auth data:', error);
  } finally {
    setIsLoading(false);
  }
};

  const refreshUser = async () => {
    const activeToken = token || (await AsyncStorage.getItem('authToken'));
    if (!activeToken) {
      return;
    }

    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${activeToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to refresh user');
    }

    const refreshedUser = await response.json();
    setUser(refreshedUser);
    setToken(activeToken);
if (Platform.OS === "web") {
  setIsPro(refreshedUser.is_premium === true);
} else {
  const customerInfo = await Purchases.getCustomerInfo();

  const proActive =
    customerInfo.entitlements.active["M.A.B. S1 path editor Pro"] !== undefined;

  setIsPro(proActive);
}
   if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.sessionStorage.setItem('user', JSON.stringify(refreshedUser));
  window.sessionStorage.setItem('authToken', activeToken);
} else {
  await AsyncStorage.setItem('user', JSON.stringify(refreshedUser));
  await AsyncStorage.setItem('authToken', activeToken);
}
  };

  const login = async (email: string, password: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Login failed');
      }

      const activeToken = data.access_token;
      const loggedInUser = data.user;

      setToken(activeToken);
      setUser(loggedInUser);
      setIsGuest(false);
      setIsPro(Boolean(loggedInUser?.is_premium));

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.sessionStorage.setItem('authToken', activeToken);
  window.sessionStorage.setItem('user', JSON.stringify(loggedInUser));
} else {
  await AsyncStorage.setItem('authToken', activeToken);
  await AsyncStorage.setItem('user', JSON.stringify(loggedInUser));
}
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };


  const register = async (email: string, username: string, password: string) => {
  try {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        username,
        password,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Registration failed');
    }

    await login(email, password);
  } catch (error) {
    console.error('Registration error:', error);
    throw error;
  }
};

 const logout = async () => {
  setUser(null);
  setToken(null);
  setIsGuest(false);
  setIsPro(false);

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem('authToken');
    window.sessionStorage.removeItem('user');

    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('user');
    await AsyncStorage.removeItem('guestMode');
  } else {
    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('user');
    await AsyncStorage.removeItem('guestMode');
  }
};

  const continueAsGuest = async () => {
    setIsGuest(true);
    await AsyncStorage.setItem('guestMode', 'true');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isGuest,
        isPro,
        checkoutMessage,
        refreshUser,
        login,
        register,
        logout,
        continueAsGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
