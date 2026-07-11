import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import Purchases from 'react-native-purchases';

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
  refreshUser: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || 'http://127.0.0.1:8000';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [isPro, setIsPro] = useState(false);

  useEffect(() => {
    // Load stored auth data on mount
    loadStoredAuth();
  }, []);

  const loadStoredAuth = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('authToken');
      const storedUser = await AsyncStorage.getItem('user');
      const guestMode = await AsyncStorage.getItem('guestMode');

      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } else if (false && guestMode === 'true') {
        setIsGuest(true);
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
    const customerInfo = await Purchases.getCustomerInfo();

    const proActive =
      customerInfo.entitlements.active['M.A.B. S1 path editor Pro'] !== undefined;

    setIsPro(proActive);
    await AsyncStorage.setItem('user', JSON.stringify(refreshedUser));
    await AsyncStorage.setItem('authToken', activeToken);
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

      await AsyncStorage.setItem('authToken', activeToken);
      await AsyncStorage.setItem('user', JSON.stringify(loggedInUser));
      await AsyncStorage.removeItem('guestMode');
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  };


  const register = async (email: string, username: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
        },
      });

      if (error) {
        throw error;
      }

      setToken(data.session?.access_token ?? null);
      setUser(data.user as any);
      setIsGuest(false);


      await AsyncStorage.setItem('user', JSON.stringify(data.user));
      await AsyncStorage.removeItem('guestMode');
    } catch (error) {
      console.error('Registration error:', error);
      throw error;
    }
  };

  const logout = async () => {
    setUser(null);
    setToken(null);
    setIsGuest(false);
    await AsyncStorage.removeItem('authToken');
    await AsyncStorage.removeItem('user');
    await AsyncStorage.removeItem('guestMode');
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
