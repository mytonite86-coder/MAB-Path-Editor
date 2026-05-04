import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MeasurementUnit, formatMeasurement } from '../utils/freecadWorkflow';

interface CADElement {
  type: string;
  points: number[][];
  properties: any;
  id: string;
}

interface SelectedElementPanelProps {
  element: CADElement | null;
  unitSystem: MeasurementUnit;
  onUpdateValue: (field: string, value: string) => void;
  onApplyConstraint: (constraint: 'horizontal' | 'vertical' | 'free') => void;
  onOpenFeatureProperties: () => void;
}

const getLength = (element: CADElement) => {
  if (element.type === 'line' && element.points.length >= 2) {
    const dx = element.points[1][0] - element.points[0][0];
    const dy = element.points[1][1] - element.points[0][1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  if (element.type === 'rectangle' && element.points.length >= 2) {
    return Math.abs(element.points[1][0] - element.points[0][0]);
  }

  return 0;
};

const getHeight = (element: CADElement) => {
  if (element.type === 'rectangle' && element.points.length >= 2) {
    return Math.abs(element.points[1][1] - element.points[0][1]);
  }

  return 0;
};

const FIELD_CONFIG: Record<string, string> = {
  length: 'Length',
  height: 'Height',
  depth: 'Depth',
  diameter: 'Diameter',
  panelHeight: 'Panel Height',
  thickness: 'Thickness',
};

export const SelectedElementPanel = ({
  element,
  unitSystem,
  onUpdateValue,
  onApplyConstraint,
  onOpenFeatureProperties,
}: SelectedElementPanelProps) => {
  if (!element) {
    return null;
  }

  const fields: { key: string; value: string }[] = [];

  if (element.type === 'line') {
    fields.push({ key: 'length', value: formatMeasurement(getLength(element), unitSystem) });
    fields.push({ key: 'depth', value: formatMeasurement(Number(element.properties?.depth || 10), unitSystem) });

    if (element.properties?.draftMode === 'panel') {
      fields.push({
        key: 'panelHeight',
        value: formatMeasurement(Number(element.properties?.threeD?.height || 203.2), unitSystem),
      });
      fields.push({
        key: 'thickness',
        value: formatMeasurement(Number(element.properties?.threeD?.thickness || element.properties?.depth || 3), unitSystem),
      });
    }
  }

  if (element.type === 'rectangle') {
    fields.push({ key: 'length', value: formatMeasurement(getLength(element), unitSystem) });
    fields.push({ key: 'height', value: formatMeasurement(getHeight(element), unitSystem) });
    fields.push({ key: 'depth', value: formatMeasurement(Number(element.properties?.depth || 10), unitSystem) });
  }

  if (element.type === 'circle') {
    fields.push({
      key: 'diameter',
      value: formatMeasurement((Number(element.properties?.radius || 0) * 2), unitSystem),
    });
    fields.push({ key: 'depth', value: formatMeasurement(Number(element.properties?.depth || 10), unitSystem) });
  }

  const isFeatureDriven = Boolean(element.properties?.featureId);

  return (
    <View style={styles.container} testID="selected-element-panel">
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>SELECTED GEOMETRY</Text>
          <Text style={styles.title}>{element.properties?.label || element.type}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{element.type.toUpperCase()}</Text>
        </View>
      </View>

      {isFeatureDriven ? (
        <View style={styles.featureBox}>
          <Text style={styles.featureText}>
            This shape is driven by the FreeCAD-style feature tree.
          </Text>
          <TouchableOpacity
            style={styles.featureButton}
            onPress={onOpenFeatureProperties}
            testID="selected-element-open-feature-properties-button"
          >
            <Ionicons name="options" size={16} color="#fff" />
            <Text style={styles.featureButtonText}>Open Feature Properties</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.fieldRow}>
              {fields.map((field) => (
                <View key={field.key} style={styles.fieldCard}>
                  <Text style={styles.fieldLabel}>{FIELD_CONFIG[field.key]} ({unitSystem})</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={field.value}
                    onChangeText={(value) => onUpdateValue(field.key, value)}
                    keyboardType="numeric"
                    placeholderTextColor="#666"
                    testID={`selected-element-${field.key}-input`}
                  />
                </View>
              ))}
            </View>
          </ScrollView>

          {element.type === 'line' && (
            <View style={styles.constraintsSection}>
              <Text style={styles.fieldLabel}>Sketch Constraints</Text>
              <View style={styles.constraintRow}>
                <TouchableOpacity
                  style={styles.constraintButton}
                  onPress={() => onApplyConstraint('horizontal')}
                  testID="selected-element-horizontal-constraint-button"
                >
                  <Text style={styles.constraintText}>Horizontal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.constraintButton}
                  onPress={() => onApplyConstraint('vertical')}
                  testID="selected-element-vertical-constraint-button"
                >
                  <Text style={styles.constraintText}>Vertical</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.constraintButton}
                  onPress={() => onApplyConstraint('free')}
                  testID="selected-element-free-constraint-button"
                >
                  <Text style={styles.constraintText}>Free</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111115',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  label: {
    color: '#7E7E87',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  badge: {
    backgroundColor: 'rgba(0,122,255,0.16)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldCard: {
    width: 142,
    backgroundColor: '#0A0A0A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  fieldLabel: {
    color: '#8F8F98',
    fontSize: 11,
    marginBottom: 8,
  },
  fieldInput: {
    backgroundColor: '#151518',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2E2E36',
  },
  constraintsSection: {
    marginTop: 14,
  },
  constraintRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  constraintButton: {
    backgroundColor: '#24242B',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  constraintText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  featureBox: {
    backgroundColor: '#0A0A0A',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  featureText: {
    color: '#C9C9D1',
    fontSize: 13,
    lineHeight: 20,
  },
  featureButton: {
    marginTop: 12,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },
});