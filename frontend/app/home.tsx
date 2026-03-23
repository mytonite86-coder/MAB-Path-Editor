import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Home() {
  const { user, isGuest, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        onPress: async () => {
          await logout();
          router.replace('/auth');
        },
      },
    ]);
  };

  const handleNewProject = () => {
    router.push('/canvas');
  };

  const handleMyBlueprints = () => {
    if (isGuest) {
      Alert.alert(
        'Account Required',
        'Please create an account to save and view blueprints.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Up', onPress: () => router.push('/auth') },
        ]
      );
    } else {
      router.push('/gallery');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>
            {isGuest ? 'Welcome, Guest!' : `Welcome, ${user?.username}!`}
          </Text>
          {user?.is_premium && (
            <View style={styles.premiumBadge}>
              <Ionicons name="star" size={12} color="#FFD700" />
              <Text style={styles.premiumText}>Premium</Text>
            </View>
          )}
          {isGuest && (
            <Text style={styles.guestWarning}>Limited features in guest mode</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => router.push('/profile')}>
          <Ionicons name="person-circle-outline" size={40} color="#007AFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>

        <TouchableOpacity style={styles.card} onPress={handleNewProject}>
          <View style={styles.cardIcon}>
            <Ionicons name="add-circle" size={48} color="#007AFF" />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>New Blueprint</Text>
            <Text style={styles.cardDescription}>
              Start a new CAD blueprint from scratch
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#666" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/canvas?mode=text')}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="text" size={48} color="#34C759" />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Text to CAD</Text>
            <Text style={styles.cardDescription}>
              Generate blueprint from text description
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#666" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/canvas?mode=image')}
        >
          <View style={styles.cardIcon}>
            <Ionicons name="image" size={48} color="#FF9500" />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Image to CAD</Text>
            <Text style={styles.cardDescription}>
              Convert image/sketch to CAD blueprint
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color="#666" />
        </TouchableOpacity>

        {!isGuest && (
          <TouchableOpacity style={styles.card} onPress={handleMyBlueprints}>
            <View style={styles.cardIcon}>
              <Ionicons name="folder-open" size={48} color="#5856D6" />
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle}>My Blueprints</Text>
              <Text style={styles.cardDescription}>
                View and manage saved blueprints
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="#666" />
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Features</Text>

        <View style={styles.featuresGrid}>
          <View style={styles.featureCard}>
            <Ionicons name="pencil" size={32} color="#007AFF" />
            <Text style={styles.featureTitle}>Draw Tools</Text>
            <Text style={styles.featureText}>Lines, shapes, polygons</Text>
          </View>

          <View style={styles.featureCard}>
            <Ionicons name="layers" size={32} color="#34C759" />
            <Text style={styles.featureTitle}>Layers</Text>
            <Text style={styles.featureText}>Organize your work</Text>
          </View>

          <View style={styles.featureCard}>
            <Ionicons name="resize" size={32} color="#FF9500" />
            <Text style={styles.featureTitle}>Precision</Text>
            <Text style={styles.featureText}>Accurate measurements</Text>
          </View>

          <View style={styles.featureCard}>
            <Ionicons name="download" size={32} color="#5856D6" />
            <Text style={styles.featureTitle}>Export</Text>
            <Text style={styles.featureText}>PDF, PNG, DXF</Text>
          </View>
        </View>
      </ScrollView>

      {(isGuest || !user?.is_premium) && (
        <View style={styles.upgradeBar}>
          <Text style={styles.upgradeText}>
            {isGuest
              ? 'Sign up to unlock full features!'
              : 'Upgrade to Premium for unlimited AI generations'}
          </Text>
          <TouchableOpacity
            style={styles.upgradeButton}
            onPress={() => (isGuest ? router.push('/auth') : router.push('/profile'))}
          >
            <Text style={styles.upgradeButtonText}>
              {isGuest ? 'Sign Up' : 'Upgrade'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  premiumText: {
    color: '#FFD700',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  guestWarning: {
    color: '#FF9500',
    fontSize: 12,
    marginTop: 4,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  cardIcon: {
    marginRight: 16,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#666',
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  featureCard: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginTop: 8,
  },
  featureText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  upgradeBar: {
    backgroundColor: '#007AFF',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  upgradeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  upgradeButton: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  upgradeButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
});