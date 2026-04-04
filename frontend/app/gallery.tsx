import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface Blueprint {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  elements: any[];
}

export default function Gallery() {
  const { token, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!token) {
      setLoading(false);
      return;
    }

    loadBlueprints();
  }, [token, authLoading]);

  const loadBlueprints = async () => {
    try {
      const response = await fetch(`${API_URL}/api/blueprints`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load blueprints');
      }

      const data = await response.json();
      setBlueprints(data);
    } catch (error: any) {
      console.error('Error loading blueprints:', error);
      Alert.alert('Error', error.message || 'Failed to load blueprints');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadBlueprints();
  };

  const handleDelete = async (id: string, name: string) => {
    Alert.alert(
      'Delete Blueprint',
      `Are you sure you want to delete "${name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_URL}/api/blueprints/${id}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${token}`,
                },
              });

              if (!response.ok) {
                throw new Error('Failed to delete blueprint');
              }

              Alert.alert('Success', 'Blueprint deleted successfully');
              loadBlueprints();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete blueprint');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleViewBlueprint = (blueprint: Blueprint) => {
    router.push({
      pathname: '/canvas',
      params: { blueprintId: blueprint.id },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading blueprints...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="gallery-screen">
      <View style={styles.header} testID="gallery-header">
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} testID="gallery-back-button">
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} testID="gallery-title">My Blueprints</Text>
        <TouchableOpacity onPress={handleRefresh} style={styles.refreshButton} testID="gallery-refresh-button">
          <Ionicons name="refresh" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} testID="gallery-content-scroll">
        {blueprints.length === 0 ? (
          <View style={styles.emptyState} testID="gallery-empty-state">
            <Ionicons name="folder-open-outline" size={64} color="#666" />
            <Text style={styles.emptyTitle}>No Blueprints Yet</Text>
            <Text style={styles.emptyText}>
              Create your first blueprint to see it here
            </Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push('/canvas')}
              testID="gallery-create-blueprint-button"
            >
              <Ionicons name="add-circle" size={20} color="#fff" />
              <Text style={styles.createButtonText}>Create Blueprint</Text>
            </TouchableOpacity>
          </View>
        ) : (
          blueprints.map((blueprint) => (
            <View key={blueprint.id} style={styles.card} testID={`gallery-blueprint-card-${blueprint.id}`}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <Ionicons name="document-outline" size={32} color="#007AFF" />
                </View>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{blueprint.name}</Text>
                  <Text style={styles.cardDate}>
                    Updated {formatDate(blueprint.updated_at)}
                  </Text>
                  <Text style={styles.cardInfo}>
                    {blueprint.elements.length} elements
                  </Text>
                </View>
              </View>

              {blueprint.description && (
                <Text style={styles.cardDescription}>{blueprint.description}</Text>
              )}

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleViewBlueprint(blueprint)}
                  testID={`gallery-view-blueprint-button-${blueprint.id}`}
                >
                  <Ionicons name="eye-outline" size={20} color="#007AFF" />
                  <Text style={styles.actionButtonText}>View</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    // TODO: Export blueprint
                    Alert.alert('Coming Soon', 'Export feature coming soon');
                  }}
                  testID={`gallery-export-blueprint-button-${blueprint.id}`}
                >
                  <Ionicons name="download-outline" size={20} color="#34C759" />
                  <Text style={styles.actionButtonText}>Export</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => handleDelete(blueprint.id, blueprint.name)}
                  testID={`gallery-delete-blueprint-button-${blueprint.id}`}
                >
                  <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                  <Text style={[styles.actionButtonText, { color: '#FF3B30' }]}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
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
  refreshButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  createButton: {
    backgroundColor: '#007AFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  cardHeader: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  cardIcon: {
    marginRight: 12,
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
  cardDate: {
    fontSize: 14,
    color: '#666',
    marginBottom: 2,
  },
  cardInfo: {
    fontSize: 12,
    color: '#888',
  },
  cardDescription: {
    fontSize: 14,
    color: '#999',
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  actionButtonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 4,
  },
});