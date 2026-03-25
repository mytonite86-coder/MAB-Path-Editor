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
import { FeatureTreePanel } from '../components/FeatureTreePanel';
import { FeaturePropertySheet } from '../components/FeaturePropertySheet';
import {
  FreeCADFeature,
  FreeCADFeatureParams,
  FreeCADFeatureType,
  buildElementsFromFeatures,
  createFeature,
} from '../utils/freecadWorkflow';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

interface CADElement {
  type: string;
  points: number[][];
  properties: any;
  id: string;
  depth?: number; // Z-axis depth for 3D
}

export default function Canvas() {
  const { mode } = useLocalSearchParams();
  const { token, user, isGuest } = useAuth();
  const router = useRouter();

  const [elements, setElements] = useState<CADElement[]>([]);
  const [freecadFeatures, setFreecadFeatures] = useState<FreeCADFeature[]>([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [showFeatureSheet, setShowFeatureSheet] = useState(false);
  const [activeTool, setActiveTool] = useState('select');
  const [activeColor, setActiveColor] = useState('#000000');
  const [activeStrokeWidth, setActiveStrokeWidth] = useState(2);
  const [canvasBackground, setCanvasBackground] = useState<'dark' | 'light'>('dark');
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [activeDepth, setActiveDepth] = useState('10'); // Default depth for 3D
  const [panelHeight, setPanelHeight] = useState('203.2');
  const [sheetThickness, setSheetThickness] = useState('3');
  const [viewportResetSignal, setViewportResetSignal] = useState(0);
  
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiMode, setAiMode] = useState<'text' | 'image' | null>(null);
  const [textPrompt, setTextPrompt] = useState('');
  const [imageInstructions, setImageInstructions] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [blueprintName, setBlueprintName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const parseDepthValue = (value: unknown) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : Number(activeDepth) || 10;
  };

  const parsePositiveValue = (value: unknown, fallback: number) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
  };

  const normalizeElements = (incomingElements: CADElement[] = []) => {
    return incomingElements.map((element, index) => ({
      ...element,
      id: element.id || `cad-element-${Date.now()}-${index}`,
      properties: {
        color: '#000000',
        strokeWidth: 2,
        ...element.properties,
        depth: parseDepthValue(element.properties?.depth),
      },
    }));
  };

  const syncFeatureElements = (nextFeatures: FreeCADFeature[]) => {
    const featureElements = buildElementsFromFeatures(nextFeatures) as CADElement[];
    setElements((currentElements) => {
      const manualElements = currentElements.filter((element) => !element.properties?.featureId);
      return [...manualElements, ...featureElements];
    });
  };

  const handleAddFreecadFeature = (type: FreeCADFeatureType) => {
    const nextFeature = createFeature(type, freecadFeatures.length);
    const nextFeatures = [...freecadFeatures, nextFeature];
    setFreecadFeatures(nextFeatures);
    syncFeatureElements(nextFeatures);
    setSelectedFeatureId(nextFeature.id);
    setSelectedElementId(`feature-element-${nextFeature.id}`);
    setShowFeatureSheet(true);
    setActiveTool('select');
  };

  const handleSelectFreecadFeature = (featureId: string) => {
    setSelectedFeatureId(featureId);
    setSelectedElementId(`feature-element-${featureId}`);
    setShowFeatureSheet(true);
    setActiveTool('select');
  };

  const handleUpdateFeature = (featureId: string, updates: Partial<FreeCADFeature>) => {
    const nextFeatures = freecadFeatures.map((feature) =>
      feature.id === featureId ? { ...feature, ...updates } : feature
    );
    setFreecadFeatures(nextFeatures);
    syncFeatureElements(nextFeatures);
  };

  const handleUpdateFeatureParam = (
    featureId: string,
    param: keyof FreeCADFeatureParams,
    value: string
  ) => {
    const nextFeatures = freecadFeatures.map((feature) => {
      if (feature.id !== featureId) {
        return feature;
      }

      const parsedValue = Number(value);
      return {
        ...feature,
        params: {
          ...feature.params,
          [param]: Number.isFinite(parsedValue) ? parsedValue : feature.params[param],
        },
      };
    });

    setFreecadFeatures(nextFeatures);
    syncFeatureElements(nextFeatures);
  };

  const handleRemoveFeature = (featureId: string) => {
    const nextFeatures = freecadFeatures.filter((feature) => feature.id !== featureId);
    setFreecadFeatures(nextFeatures);
    syncFeatureElements(nextFeatures);
    setSelectedFeatureId(null);
    setSelectedElementId(null);
    setShowFeatureSheet(false);
  };

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
      const normalizedElements = normalizeElements(data.elements);
      setElements(normalizedElements);
      setFreecadFeatures([]);
      setSelectedFeatureId(null);
      setShowFeatureSheet(false);
      setActiveTool('select');
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
      const normalizedElements = normalizeElements(data.elements);
      setElements(normalizedElements);
      setFreecadFeatures([]);
      setSelectedFeatureId(null);
      setShowFeatureSheet(false);
      setActiveTool('select');
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

  const handleDelete = () => {
    if (!selectedElementId) {
      Alert.alert('No Selection', 'Please select an element first');
      return;
    }

    const selectedElement = elements.find((element) => element.id === selectedElementId);
    const featureId = selectedElement?.properties?.featureId;
    
    Alert.alert(
      'Delete Element',
      'Are you sure you want to delete this element?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (featureId) {
              handleRemoveFeature(featureId);
              return;
            }
            setElements(elements.filter(el => el.id !== selectedElementId));
            setSelectedElementId(null);
          },
        },
      ]
    );
  };

  const handleClear = () => {
    Alert.alert(
      'Clear Canvas',
      'Are you sure you want to clear all elements?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: () => {
          setElements([]);
          setFreecadFeatures([]);
          setSelectedFeatureId(null);
          setShowFeatureSheet(false);
          setSelectedElementId(null);
        }},
      ]
    );
  };

  const handleUndo = () => {
    if (elements.length > 0) {
      setElements(elements.slice(0, -1));
    }
  };

  const handleConvertLinesToPanels = () => {
    const targetHeight = parsePositiveValue(panelHeight, 203.2);
    const targetThickness = parsePositiveValue(sheetThickness, 3);
    const hasLineElements = elements.some((element) => element.type === 'line');

    if (!hasLineElements) {
      Alert.alert('No Lines Found', 'Draw some line edges first, then convert them to sheet panels.');
      return;
    }

    setElements((currentElements) =>
      currentElements.map((element) => {
        if (element.type !== 'line') {
          return element;
        }

        return {
          ...element,
          properties: {
            ...element.properties,
            depth: targetThickness,
            draftMode: 'panel',
            filled: true,
            threeD: {
              shape: 'panelLine',
              height: targetHeight,
              thickness: targetThickness,
            },
          },
        };
      })
    );

    setActiveTool('select');
    Alert.alert('Sheet Panels Ready', 'Your line sketch was converted into panel-style 3D elements.');
  };

  const tools = [
    { id: 'select', icon: 'hand-left', label: 'Select' },
    { id: 'pan', icon: 'resize', label: 'Pan' },
    { id: 'line', icon: 'remove', label: 'Line' },
    { id: 'panel', icon: 'layers', label: 'Panel' },
    { id: 'rectangle', icon: 'square-outline', label: 'Rectangle' },
    { id: 'circle', icon: 'ellipse-outline', label: 'Circle' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header} testID="cad-canvas-header">
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          testID="cad-canvas-back-button"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} testID="cad-canvas-title">CAD Canvas</Text>
        <View style={styles.headerButtons}>
          {selectedElementId && (
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.headerButton}
              testID="cad-canvas-delete-selected-button"
            >
              <Ionicons name="trash" size={24} color="#FF3B30" />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={handleUndo}
            style={styles.headerButton}
            testID="cad-canvas-undo-button"
          >
            <Ionicons name="arrow-undo" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleClear}
            style={styles.headerButton}
            testID="cad-canvas-clear-button"
          >
            <Ionicons name="trash-outline" size={24} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.canvasContainer}>
        <CADCanvas
          elements={elements}
          onElementsChange={setElements}
          activeTool={activeTool}
          activeColor={activeColor}
          activeStrokeWidth={activeStrokeWidth}
          activeDepth={parseDepthValue(activeDepth)}
          panelHeight={parsePositiveValue(panelHeight, 203.2)}
          sheetThickness={parsePositiveValue(sheetThickness, 3)}
          backgroundColor={canvasBackground}
          selectedElementId={selectedElementId}
          onElementSelect={setSelectedElementId}
          viewportResetSignal={viewportResetSignal}
        />
      </View>

      <ScrollView style={styles.controlsContainer} contentContainerStyle={styles.controlsContent}>

        <View style={styles.workflowIntroCard} testID="freecad-workflow-intro-card">
          <Text style={styles.workflowIntroLabel}>MOBILE FREECAD-STYLE MVP</Text>
          <Text style={styles.workflowIntroTitle}>Sketch → Features → Properties → 3D</Text>
          <Text style={styles.workflowIntroText}>
            1. Add a Pad or Base Wall from the feature tree.{"\n"}
            2. Tap a feature row to edit exact dimensions.{"\n"}
            3. Add Flanges or Hems, then open 3D.{"\n"}
            4. Use the regular drawing tools for quick freeform edits.
          </Text>
        </View>

        <FeatureTreePanel
          features={freecadFeatures}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={handleSelectFreecadFeature}
          onAddFeature={handleAddFreecadFeature}
        />

        <Text style={styles.sectionTitle}>Drawing Tools</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.toolsScroll}>
          {tools.map((tool) => (
            <TouchableOpacity
              key={tool.id}
              style={[styles.toolButton, activeTool === tool.id && styles.toolButtonActive]}
              onPress={() => setActiveTool(tool.id)}
              testID={`cad-tool-${tool.id}`}
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
              testID="cad-canvas-background-toggle"
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
                testID={`cad-color-${item.label.toLowerCase()}`}
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

        <View style={styles.depthSection}>
          <Text style={styles.sectionTitle}>3D Depth (mm)</Text>
          <View style={styles.depthControls}>
            <TextInput
              style={styles.depthInput}
              value={activeDepth}
              onChangeText={setActiveDepth}
              keyboardType="numeric"
              placeholder="10"
              placeholderTextColor="#666"
              testID="cad-depth-input"
            />
            <View style={styles.depthPresets}>
              {['5', '10', '20', '50'].map((depth) => (
                <TouchableOpacity
                  key={depth}
                  style={[
                    styles.depthPreset,
                    activeDepth === depth && styles.depthPresetActive,
                  ]}
                  onPress={() => setActiveDepth(depth)}
                  testID={`cad-depth-preset-${depth}`}
                >
                  <Text
                    style={[
                      styles.depthPresetText,
                      activeDepth === depth && styles.depthPresetTextActive,
                    ]}
                  >
                    {depth}mm
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Text style={styles.depthHint}>
            Set depth for new shapes (for 3D view)
          </Text>
        </View>

        <View style={styles.depthSection}>
          <Text style={styles.sectionTitle}>Sheet Drafting</Text>
          <View style={styles.sheetDraftRow}>
            <View style={styles.sheetDraftInputGroup}>
              <Text style={styles.sheetDraftLabel}>Panel Height</Text>
              <TextInput
                style={styles.sheetDraftInput}
                value={panelHeight}
                onChangeText={setPanelHeight}
                keyboardType="numeric"
                placeholder="203.2"
                placeholderTextColor="#666"
                testID="cad-panel-height-input"
              />
            </View>
            <View style={styles.sheetDraftInputGroup}>
              <Text style={styles.sheetDraftLabel}>Thickness</Text>
              <TextInput
                style={styles.sheetDraftInput}
                value={sheetThickness}
                onChangeText={setSheetThickness}
                keyboardType="numeric"
                placeholder="3"
                placeholderTextColor="#666"
                testID="cad-sheet-thickness-input"
              />
            </View>
          </View>

          <View style={styles.sheetDraftActions}>
            <TouchableOpacity
              style={styles.sheetDraftButton}
              onPress={handleConvertLinesToPanels}
              testID="cad-convert-lines-to-panels-button"
            >
              <Ionicons name="layers" size={18} color="#fff" />
              <Text style={styles.sheetDraftButtonText}>Convert Lines to Panels</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryActionButton}
              onPress={() => setViewportResetSignal((value) => value + 1)}
              testID="cad-reset-view-button"
            >
              <Ionicons name="refresh" size={18} color="#fff" />
              <Text style={styles.sheetDraftButtonText}>Center Draft View</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.depthHint}>
            Use Panel tool for sheet walls, or convert an existing line sketch into panels.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>AI Generation</Text>
        <View style={styles.aiButtons}>
          <TouchableOpacity
            style={styles.aiButton}
            onPress={() => {
              setAiMode('text');
              setShowAIModal(true);
            }}
            testID="cad-text-to-cad-open-button"
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
            testID="cad-image-to-cad-open-button"
          >
            <Ionicons name="image" size={24} color="#FF9500" />
            <Text style={styles.aiButtonText}>Image to CAD</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity 
            style={styles.view3DButton} 
            onPress={() => {
              if (elements.length === 0) {
                Alert.alert('No Elements', 'Please draw or generate some elements first');
                return;
              }
              router.push({
                pathname: '/viewer3d',
                params: { elementsData: JSON.stringify(elements) }
              });
            }}
            testID="cad-view-3d-button"
          >
            <Ionicons name="cube" size={20} color="#fff" />
            <Text style={styles.view3DButtonText}>View in 3D</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSave}
            testID="cad-save-blueprint-button"
          >
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
          <View style={styles.modalContent} testID="cad-ai-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} testID="cad-ai-modal-title">
                {aiMode === 'text' ? 'Text to CAD' : 'Image to CAD'}
              </Text>
              <TouchableOpacity onPress={() => setShowAIModal(false)} testID="cad-ai-modal-close-button">
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
                  testID="cad-text-prompt-input"
                />

                <TouchableOpacity
                  style={[styles.modalButton, isGenerating && styles.modalButtonDisabled]}
                  onPress={handleGenerateFromText}
                  disabled={isGenerating}
                  testID="cad-generate-text-button"
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
                
                <TouchableOpacity
                  style={styles.imagePickerButton}
                  onPress={pickImage}
                  testID="cad-image-picker-button"
                >
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
                  testID="cad-image-instructions-input"
                />

                <TouchableOpacity
                  style={[styles.modalButton, (isGenerating || !selectedImage) && styles.modalButtonDisabled]}
                  onPress={handleGenerateFromImage}
                  disabled={isGenerating || !selectedImage}
                  testID="cad-generate-image-button"
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
          <View style={styles.modalContent} testID="cad-save-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Save Blueprint</Text>
              <TouchableOpacity onPress={() => setShowSaveModal(false)} testID="cad-save-modal-close-button">
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
                testID="cad-blueprint-name-input"
              />

              <TouchableOpacity
                style={[styles.modalButton, isSaving && styles.modalButtonDisabled]}
                onPress={handleSaveConfirm}
                disabled={isSaving}
                testID="cad-save-confirm-button"
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

      <FeaturePropertySheet
        feature={freecadFeatures.find((feature) => feature.id === selectedFeatureId) || null}
        visible={showFeatureSheet}
        onClose={() => setShowFeatureSheet(false)}
        onUpdateFeature={handleUpdateFeature}
        onUpdateParam={handleUpdateFeatureParam}
        onRemoveFeature={handleRemoveFeature}
      />
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
  canvasContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  controlsContainer: {
    flex: 1,
  },
  controlsContent: {
    padding: 16,
    paddingTop: 8,
  },
  workflowIntroCard: {
    backgroundColor: '#111115',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  workflowIntroLabel: {
    color: '#7E7E87',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  workflowIntroTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  workflowIntroText: {
    color: '#A1A1A6',
    fontSize: 13,
    lineHeight: 20,
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
  depthSection: {
    marginTop: 8,
  },
  depthControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  depthInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    width: 80,
    fontSize: 16,
  },
  depthPresets: {
    flexDirection: 'row',
    gap: 8,
    flex: 1,
  },
  depthPreset: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  depthPresetActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  depthPresetText: {
    color: '#fff',
    fontSize: 12,
  },
  depthPresetTextActive: {
    fontWeight: '600',
  },
  depthHint: {
    color: '#666',
    fontSize: 11,
    marginTop: 6,
    fontStyle: 'italic',
  },
  sheetDraftRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sheetDraftInputGroup: {
    flex: 1,
  },
  sheetDraftLabel: {
    color: '#999',
    fontSize: 12,
    marginBottom: 6,
  },
  sheetDraftInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 15,
  },
  sheetDraftActions: {
    gap: 10,
    marginTop: 12,
  },
  sheetDraftButton: {
    backgroundColor: '#5856D6',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionButton: {
    backgroundColor: '#444',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetDraftButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
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
    gap: 12,
  },
  view3DButton: {
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  view3DButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
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
