import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import CADCanvas from '../components/CADCanvas';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface CADElement {
  type: string;
  points: number[][];
  properties: any;
  id?: string;
}

export default function Canvas() {
  const { mode } = useLocalSearchParams();
  const { token, user, isGuest } = useAuth();
  const router = useRouter();

  const [elements, setElements] = useState<CADElement[]>([]);
  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#000000');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState(2);
  const [canvasBackground, setCanvasBackground] = useState<'dark' | 'light'>('dark');
  
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiMode, setAiMode] = useState<'text' | 'image' | null>(null);
  const [textPrompt, setTextPrompt] = useState('');
  const [imageInstructions, setImageInstructions] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [blueprintName, setBlueprintName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (mode === 'text') {
      setAiMode('text');
      setShowAIModal(true);
    } else if (mode === 'image') {
      setAiMode('image');
      setShowAIModal(true);
    }
  }, [mode]);

  const handleGenerateFromText = async () => {
    if (!textPrompt.trim()) {
      Alert.alert('Error', 'Please enter a description');
      return;
    }

    setIsGenerating(true);
    try {
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_URL}/api/ai/text-to-cad`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: textPrompt }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate CAD from text');
      }

      const data = await response.json();
      setElements(data.elements);
      setShowAIModal(false);
      setTextPrompt('');
      
      Alert.alert('Success', data.description);
    } catch (error: any) {
      console.error('Error generating from text:', error);
      Alert.alert('Error', error.message || 'Failed to generate blueprint');
    } finally {
      setIsGenerating(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please grant camera roll permissions to upload images');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets[0].base64) {
      setSelectedImage(result.assets[0].base64);
    }
  };

  const handleGenerateFromImage = async () => {
    if (!selectedImage) {
      Alert.alert('Error', 'Please select an image');
      return;
    }

    setIsGenerating(true);
    try {
      const headers: any = {
        'Content-Type': 'application/json',
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_URL}/api/ai/image-to-cad`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image_base64: selectedImage,
          instructions: imageInstructions || null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate CAD from image');
      }

      const data = await response.json();
      setElements(data.elements);
      setShowAIModal(false);
      setSelectedImage(null);
      setImageInstructions('');
      
      Alert.alert('Success', data.description);
    } catch (error: any) {
      console.error('Error generating from image:', error);
      Alert.alert('Error', error.message || 'Failed to generate blueprint');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (isGuest) {
      Alert.alert(
        'Account Required',
        'Please create an account to save blueprints',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign Up', onPress: () => router.push('/auth') },
        ]
      );
      return;
    }

    setShowSaveModal(true);
  };

  const handleSaveConfirm = async () => {
    if (!blueprintName.trim()) {
      Alert.alert('Error', 'Please enter a blueprint name');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/blueprints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: blueprintName,
          elements: elements,
          tags: [],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save blueprint');
      }

      Alert.alert('Success', 'Blueprint saved successfully!');
      setShowSaveModal(false);
      setBlueprintName('');
    } catch (error: any) {
      console.error('Error saving blueprint:', error);
      Alert.alert('Error', error.message || 'Failed to save blueprint');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = () => {
    Alert.alert(
      'Clear Canvas',
      'Are you sure you want to clear all elements?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => setElements([]) },
      ]
    );
  };

  const handleUndo = () => {
    if (elements.length > 0) {
      setElements(elements.slice(0, -1));
    }
  };

  const tools = [
    { id: 'select', icon: 'hand-left', label: 'Select' },
    { id: 'line', icon: 'remove', label: 'Line' },
    { id: 'rectangle', icon: 'square-outline', label: 'Rectangle' },
    { id: 'circle', icon: 'ellipse-outline', label: 'Circle' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>CAD Canvas</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity onPress={handleUndo} style={styles.headerButton}>
            <Ionicons name="arrow-undo" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleClear} style={styles.headerButton}>
            <Ionicons name="trash-outline" size={24} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content}>
        <CADCanvas
          elements={elements}
          onElementsChange={setElements}
          activeTool={activeTool}
          activeColor={activeColor}
          activeStrokeWidth={activeStrokeWidth}
          backgroundColor={canvasBackground}
        />

        <Text style={styles.sectionTitle}>Drawing Tools</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolsScroll}>
          {tools.map((tool) => (
            <TouchableOpacity
              key={tool.id}
              style={[styles.toolButton, activeTool === tool.id && styles.toolButtonActive]}
              onPress={() => setActiveTool(tool.id)}
            >
              <Ionicons
                name={tool.icon as any}
                size={24}
                color={activeTool === tool.id ? '#007AFF' : '#fff'}
              />
              <Text
                style={[styles.toolLabel, activeTool === tool.id && styles.toolLabelActive]}
              >
                {tool.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.colorSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Line Color</Text>
            <TouchableOpacity
              style={styles.backgroundToggle}
              onPress={() => setCanvasBackground(canvasBackground === 'dark' ? 'light' : 'dark')}
            >
              <Ionicons
                name={canvasBackground === 'dark' ? 'moon' : 'sunny'}
                size={20}
                color="#fff"
              />
              <Text style={styles.backgroundToggleText}>
                {canvasBackground === 'dark' ? 'Dark' : 'Light'} Canvas
              </Text>
            </TouchableOpacity>
          </View>
          
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.colorScroll}>
            {[
              { color: '#000000', label: 'Black' },
              { color: '#FFFFFF', label: 'White' },
              { color: '#FF0000', label: 'Red' },
              { color: '#00FF00', label: 'Green' },
              { color: '#0000FF', label: 'Blue' },
              { color: '#FFFF00', label: 'Yellow' },
              { color: '#FF00FF', label: 'Magenta' },
              { color: '#00FFFF', label: 'Cyan' },
              { color: '#FFA500', label: 'Orange' },
              { color: '#800080', label: 'Purple' },
            ].map((item) => (
              <TouchableOpacity
                key={item.color}
                style={[
                  styles.colorButton,
                  activeColor === item.color && styles.colorButtonActive,
                ]}
                onPress={() => setActiveColor(item.color)}
              >
                <View
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: item.color },
                    item.color === '#FFFFFF' && { borderWidth: 1, borderColor: '#666' },
                  ]}
                />
                <Text style={styles.colorLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <Text style={styles.sectionTitle}>AI Generation</Text>
        <View style={styles.aiButtons}>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={() => {
              setAiMode('text');
              setShowAIModal(true);
            }}
          >
            <Ionicons name="text" size={24} color="#34C759" />
            <Text style={styles.aiButtonText}>Text to CAD</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.aiButton}
            onPress={() => {
              setAiMode('image');
              setShowAIModal(true);
            }}
          >
            <Ionicons name="image" size={24} color="#FF9500" />
            <Text style={styles.aiButtonText}>Image to CAD</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Ionicons name="save" size={20} color="#fff" />
            <Text style={styles.saveButtonText}>Save Blueprint</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* AI Generation Modal */}
      <Modal visible={showAIModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {aiMode === 'text' ? 'Text to CAD' : 'Image to CAD'}
              </Text>
              <TouchableOpacity onPress={() => setShowAIModal(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            {aiMode === 'text' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalLabel}>Describe your blueprint:</Text>
                <TextInput
                  style={styles.modalTextArea}
                  placeholder="e.g., Create a 10x15 room with a door on the north wall and a window on the east wall"
                  placeholderTextColor="#666"
                  value={textPrompt}
                  onChangeText={setTextPrompt}
                  multiline
                  numberOfLines={4}
                />

                <TouchableOpacity
                  style={[styles.modalButton, isGenerating && styles.modalButtonDisabled]}
                  onPress={handleGenerateFromText}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="#fff" />
                      <Text style={styles.modalButtonText}>Generate Blueprint</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {aiMode === 'image' && (
              <View style={styles.modalBody}>
                <Text style={styles.modalLabel}>Upload an image or sketch:</Text>
                
                <TouchableOpacity style={styles.imagePickerButton} onPress={pickImage}>
                  <Ionicons name="cloud-upload" size={32} color="#007AFF" />
                  <Text style={styles.imagePickerText}>
                    {selectedImage ? 'Image Selected ✓' : 'Select Image'}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.modalLabel}>Additional instructions (optional):</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g., Focus on the floor plan, ignore background"
                  placeholderTextColor="#666"
                  value={imageInstructions}
                  onChangeText={setImageInstructions}
                />

                <TouchableOpacity
                  style={[styles.modalButton, (isGenerating || !selectedImage) && styles.modalButtonDisabled]}
                  onPress={handleGenerateFromImage}
                  disabled={isGenerating || !selectedImage}
                >
                  {isGenerating ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="#fff" />
                      <Text style={styles.modalButtonText}>Generate from Image</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Save Modal */}
      <Modal visible={showSaveModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Save Blueprint</Text>
              <TouchableOpacity onPress={() => setShowSaveModal(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.modalLabel}>Blueprint Name:</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g., House Floor Plan"
                placeholderTextColor="#666"
                value={blueprintName}
                onChangeText={setBlueprintName}
              />

              <TouchableOpacity
                style={[styles.modalButton, isSaving && styles.modalButtonDisabled]}
                onPress={handleSaveConfirm}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save" size={20} color="#fff" />
                    <Text style={styles.modalButtonText}>Save</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headerButtons: {
    flexDirection: 'row',
  },
  headerButton: {
    padding: 8,
    marginLeft: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 24,
    marginBottom: 12,
  },
  toolsScroll: {
    marginBottom: 8,
  },
  toolButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    alignItems: 'center',
    minWidth: 80,
    borderWidth: 2,
    borderColor: '#333',
  },
  toolButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#1a2a3a',
  },
  toolLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 8,
  },
  toolLabelActive: {
    color: '#007AFF',
    fontWeight: '600',
  },
  colorSection: {
    marginTop: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  backgroundToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
  },
  backgroundToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  colorScroll: {
    marginBottom: 8,
  },
  colorButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    alignItems: 'center',
    minWidth: 70,
    borderWidth: 2,
    borderColor: '#333',
  },
  colorButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#1a2a3a',
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginBottom: 6,
  },
  colorLabel: {
    color: '#fff',
    fontSize: 11,
  },
  aiButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  aiButton: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  aiButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  actions: {
    marginTop: 24,
    marginBottom: 32,
  },
  saveButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalBody: {
    gap: 16,
  },
  modalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalTextArea: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    minHeight: 120,
    textAlignVertical: 'top',
  },
  imagePickerButton: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
  },
  imagePickerText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 8,
  },
  modalButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  modalButtonDisabled: {
    opacity: 0.6,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
