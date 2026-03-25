import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  FreeCADFeature,
  FreeCADFeatureParams,
  MeasurementUnit,
  formatMeasurement,
} from '../utils/freecadWorkflow';

interface FeaturePropertySheetProps {
  feature: FreeCADFeature | null;
  visible: boolean;
  onClose: () => void;
  onUpdateFeature: (featureId: string, updates: Partial<FreeCADFeature>) => void;
  onUpdateParam: (featureId: string, param: keyof FreeCADFeatureParams, value: string) => void;
  onRemoveFeature: (featureId: string) => void;
  unitSystem: MeasurementUnit;
}

const FIELDS: { key: keyof FreeCADFeatureParams; label: string }[] = [
  { key: 'length', label: 'Length (mm)' },
  { key: 'width', label: 'Width (mm)' },
  { key: 'height', label: 'Height (mm)' },
  { key: 'thickness', label: 'Thickness (mm)' },
  { key: 'offsetX', label: 'Offset X (mm)' },
  { key: 'offsetZ', label: 'Offset Z (mm)' },
  { key: 'rotationY', label: 'Rotation Y (deg)' },
];

export const FeaturePropertySheet = ({
  feature,
  visible,
  onClose,
  onUpdateFeature,
  onUpdateParam,
  onRemoveFeature,
  unitSystem,
}: FeaturePropertySheetProps) => {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.sheet} testID="freecad-feature-property-sheet">
          <View style={styles.header}>
            <View>
              <Text style={styles.headerLabel}>PROPERTIES</Text>
              <Text style={styles.title}>{feature?.name || 'Feature'}</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              testID="freecad-close-properties-button"
            >
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          {feature && (
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.row}>
                <Text style={styles.fieldLabel}>Enabled</Text>
                <TouchableOpacity
                  style={[styles.toggleButton, feature.enabled && styles.toggleButtonActive]}
                  onPress={() => onUpdateFeature(feature.id, { enabled: !feature.enabled })}
                  testID="freecad-toggle-feature-enabled-button"
                >
                  <Text style={styles.toggleText}>{feature.enabled ? 'On' : 'Off'}</Text>
                </TouchableOpacity>
              </View>

              {FIELDS.map((field) => (
                <View key={field.key} style={styles.row}>
                  <Text style={styles.fieldLabel}>{field.label.replace('(mm)', `(${unitSystem})`)}</Text>
                  <TextInput
                    style={styles.input}
                    value={formatMeasurement(feature.params[field.key], unitSystem)}
                    onChangeText={(value) => onUpdateParam(feature.id, field.key, value)}
                    keyboardType="numeric"
                    placeholderTextColor="#666"
                    testID={`freecad-property-${field.key}-input`}
                  />
                </View>
              ))}

              <TouchableOpacity
                style={styles.removeButton}
                onPress={() => onRemoveFeature(feature.id)}
                testID="freecad-remove-feature-button"
              >
                <Ionicons name="trash-outline" size={18} color="#fff" />
                <Text style={styles.removeText}>Delete Feature</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
    paddingTop: 24,
  },
  sheet: {
    backgroundColor: '#151518',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingTop: 58,
    maxHeight: '82%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingRight: 48,
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    top: -4,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    color: '#7E7E87',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {
    paddingBottom: 24,
  },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  fieldLabel: {
    color: '#A1A1A6',
    fontSize: 12,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    backgroundColor: '#0A0A0A',
    fontSize: 15,
  },
  toggleButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#2A2A31',
  },
  toggleButtonActive: {
    backgroundColor: '#007AFF',
  },
  toggleText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  removeButton: {
    marginTop: 18,
    backgroundColor: '#FF3B30',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 8,
  },
});