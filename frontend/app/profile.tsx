import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function Profile() {
  const { user, isGuest, logout, token } = useAuth();
  const router = useRouter();
  const [premiumCode, setPremiumCode] = useState('');
  const [isActivating, setIsActivating] = useState(false);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/auth');
        },
      },
    ]);
  };

  const handleActivatePremium = async () => {
    if (!premiumCode.trim()) {
      Alert.alert('Error', 'Please enter a premium code');
      return;
    }

    setIsActivating(true);
    try {
      const response = await fetch(`${API_URL}/api/premium/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ code: premiumCode }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to activate premium');
      }

      const data = await response.json();
      Alert.alert('Success', data.message);
      setPremiumCode('');
      
      // Refresh the page or update user state
      Alert.alert('Please Re-login', 'Please logout and login again to see premium features');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to activate premium');
    } finally {
      setIsActivating(false);
    }
  };

  if (isGuest) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Profile</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.guestCard}>
            <Ionicons name="person-circle-outline" size={80} color="#666" />
            <Text style={styles.guestTitle}>Guest Mode</Text>
            <Text style={styles.guestText}>
              Create an account to unlock all features:
            </Text>
            <View style={styles.featuresList}>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Save blueprints</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Access blueprint library</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>More AI generations</Text>
              </View>
              <View style={styles.featureItem}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.featureText}>Premium upgrade option</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.signUpButton}
              onPress={() => router.replace('/auth')}
            >
              <Text style={styles.signUpButtonText}>Create Account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
          <Ionicons name="log-out-outline" size={24} color="#FF3B30" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.profileCard}>
          <Ionicons name="person-circle" size={80} color="#007AFF" />
          <Text style={styles.username}>{user?.username}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {user?.is_premium && (
            <View style={styles.premiumBadgeLarge}>
              <Ionicons name="star" size={20} color="#FFD700" />
              <Text style={styles.premiumBadgeText}>Premium Member</Text>
            </View>
          )}
        </View>

        {!user?.is_premium && (
          <View style={styles.upgradeCard}>
            <View style={styles.upgradeHeader}>
              <Ionicons name="star" size={32} color="#FFD700" />
              <Text style={styles.upgradeTitle}>Upgrade to Premium</Text>
            </View>
            <Text style={styles.upgradeDescription}>
              Unlock unlimited AI generations and premium features
            </Text>

            <View style={styles.premiumFeatures}>
              <View style={styles.premiumFeature}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.premiumFeatureText}>Unlimited AI generations</Text>
              </View>
              <View style={styles.premiumFeature}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.premiumFeatureText}>Export to DXF format</Text>
              </View>
              <View style={styles.premiumFeature}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.premiumFeatureText}>Advanced image processing</Text>
              </View>
              <View style={styles.premiumFeature}>
                <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                <Text style={styles.premiumFeatureText}>Priority support</Text>
              </View>
            </View>

            <Text style={styles.codeLabel}>Have a premium code?</Text>
            <TextInput
              style={styles.codeInput}
              placeholder="Enter premium code"
              placeholderTextColor="#666"
              value={premiumCode}
              onChangeText={setPremiumCode}
              autoCapitalize="characters"
            />

            <TouchableOpacity
              style={[styles.activateButton, isActivating && styles.activateButtonDisabled]}
              onPress={handleActivatePremium}
              disabled={isActivating}
            >
              {isActivating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.activateButtonText}>Activate Premium</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.bypassHint}>
              🎁 Bypass Code: CAD_PREMIUM_2025
            </Text>
          </View>
        )}

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>About</Text>
          <Text style={styles.infoText}>
            CAD Blueprint - AI-Powered Blueprint Creation
          </Text>
          <Text style={styles.infoText}>Version 1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  logoutButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  profileCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  username: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
  },
  email: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  premiumBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
  },
  premiumBadgeText: {
    color: '#FFD700',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  upgradeCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#FFD700',
  },
  upgradeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  upgradeTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 12,
  },
  upgradeDescription: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  premiumFeatures: {
    marginBottom: 24,
  },
  premiumFeature: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  premiumFeatureText: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 12,
  },
  codeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  codeInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
  },
  activateButton: {
    backgroundColor: '#FFD700',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  activateButtonDisabled: {
    opacity: 0.6,
  },
  activateButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
  },
  bypassHint: {
    textAlign: 'center',
    color: '#FFD700',
    fontSize: 14,
    marginTop: 12,
    fontWeight: '600',
  },
  guestCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  guestTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  guestText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
  featuresList: {
    alignSelf: 'stretch',
    marginTop: 24,
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#fff',
    marginLeft: 12,
  },
  signUpButton: {
    backgroundColor: '#007AFF',
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  signUpButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  infoCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
});