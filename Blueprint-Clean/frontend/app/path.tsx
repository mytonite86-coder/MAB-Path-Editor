import React, { useState } from 'react';

import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
export default function Path() {
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
const [fileContent, setFileContent] = useState<string[]>([]);
const [fileName, setFileName] = useState('');
  return (
  <ScrollView style={styles.container}>
    <Text style={styles.title}>Path Edit</Text>
    <Text style={styles.subtitle}>
      Import CNC files, inspect G-code, and preview tool movement.
    </Text>

    <TouchableOpacity
      style={styles.primaryButton}
      onPress={async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
  });

  if (!result.canceled) {
  const file = result.assets[0];

  if (file.file) {
    const content = await file.file.text();

    setFileName(file.name || 'Imported file');   // 👈 ADD THIS
   const lines = content
  .replace(/\r?\n/g, '\n')
  .replace(/(?=[A-Z][\d.-])/g, '\n')
  .split('\n')
  .filter(line => line.trim() !== '');
setFileContent(lines);                    // 👈 ADD THIS
  }
}
}}
    >
      <Ionicons name="cloud-upload-outline" size={28} color="#fff" />
      <Text style={styles.primaryText}>Import CNC File</Text>
    </TouchableOpacity>
    {fileName !== '' && (
  <View style={styles.panel}>
    <Text style={styles.panelTitle}>{fileName}</Text>
   {fileContent.slice(0, 50).map((line, i) => (
  <Text
    key={i}
    onPress={() => setSelectedLine(i)}
    style={[
      styles.panelText,
      line.includes('G') && { color: '#4FC3F7' },
      selectedLine === i && { backgroundColor: '#333' },
    ]}
  >
    {i + 1}. {line}
  </Text>
))}

  </View>
)}
    <View style={styles.panel}></View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Preview</Text>
      <Text style={styles.panelText}>Toolpath preview will render here.</Text>
    </View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>G-Code</Text>
      <Text style={styles.panelText}>
  {selectedLine !== null
    ? fileContent[selectedLine]
    : 'Select a line above'}
</Text>
    </View>
  </ScrollView>
);
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 24,
    gap: 16,
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 10,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 18,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  primaryText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  panel: {
    backgroundColor: '#1b1b1b',
    borderColor: '#333',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    minHeight: 130,
  },
  panelTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  panelText: {
    color: '#777',
    fontSize: 15,
  },
});