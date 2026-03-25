import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FreeCADFeature, FreeCADFeatureType } from '../utils/freecadWorkflow';

interface FeatureTreePanelProps {
  features: FreeCADFeature[];
  selectedFeatureId: string | null;
  onSelectFeature: (featureId: string) => void;
  onAddFeature: (type: FreeCADFeatureType) => void;
}

const QUICK_ACTIONS: { type: FreeCADFeatureType; label: string; icon: string }[] = [
  { type: 'pad', label: 'Pad', icon: 'cube' },
  { type: 'baseWall', label: 'Base Wall', icon: 'remove' },
  { type: 'flange', label: 'Flange', icon: 'layers' },
  { type: 'hem', label: 'Hem', icon: 'return-up-forward' },
];

export const FeatureTreePanel = ({
  features,
  selectedFeatureId,
  onSelectFeature,
  onAddFeature,
}: FeatureTreePanelProps) => {
  return (
    <View style={styles.container} testID="freecad-feature-tree-panel">
      <Text style={styles.sectionLabel}>FREECAD-STYLE TREE</Text>
      <Text style={styles.title}>Features & History</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.actionScroll}>
        {QUICK_ACTIONS.map((action) => (
          <TouchableOpacity
            key={action.type}
            style={styles.actionChip}
            onPress={() => onAddFeature(action.type)}
            testID={`freecad-add-${action.type}-button`}
          >
            <Ionicons name={action.icon as any} size={16} color="#fff" />
            <Text style={styles.actionText}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {features.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Start with Pad or Base Wall, then add Flanges and Hems.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {features.map((feature, index) => (
            <TouchableOpacity
              key={feature.id}
              style={[
                styles.featureRow,
                selectedFeatureId === feature.id && styles.featureRowSelected,
              ]}
              onPress={() => onSelectFeature(feature.id)}
              testID={`freecad-feature-row-${index}`}
            >
              <View style={styles.featureIndexBadge}>
                <Text style={styles.featureIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.featureBody}>
                <Text style={styles.featureName}>{feature.name}</Text>
                <Text style={styles.featureMeta}>
                  {feature.type} · {feature.enabled ? 'enabled' : 'disabled'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#666" />
            </TouchableOpacity>
          ))}
        </View>
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
  },
  sectionLabel: {
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
    marginBottom: 12,
  },
  actionScroll: {
    marginBottom: 12,
  },
  actionChip: {
    backgroundColor: 'rgba(0,122,255,0.16)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  emptyState: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
    backgroundColor: '#0A0A0A',
  },
  emptyText: {
    color: '#9B9BA3',
    fontSize: 13,
    lineHeight: 20,
  },
  list: {
    gap: 10,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  featureRowSelected: {
    borderColor: '#007AFF',
    backgroundColor: 'rgba(0,122,255,0.12)',
  },
  featureIndexBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1D1D22',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  featureIndexText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  featureBody: {
    flex: 1,
  },
  featureName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  featureMeta: {
    color: '#8A8A93',
    fontSize: 12,
    textTransform: 'capitalize',
  },
});