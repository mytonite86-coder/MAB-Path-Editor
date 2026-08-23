import React, { useState, useRef } from 'react';

import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'expo-router';
import {
  decodeTextDocument,
  detectContainer,
  encodeTextDocument,
  interpretToolpath,
  patchMotionBlock,
  readMotionBlockValues,
  serializeTextDocument,
  type TextDocument,
} from '../utils/gcodeDocument';

type MovementMode = 'G00' | 'G01' | 'G02' | 'G03';

type ToolpathPoint = {
  x: number;
  y: number;
  line?: number;
  mode?: MovementMode;
  pierce?: boolean;
  commandEnd?: boolean;
};

const movementColor: Record<MovementMode, string> = {
  G00: '#FF9F0A',
  G01: '#35D0E5',
  G02: '#64D2FF',
  G03: '#5E5CE6',
};

export default function Path() {
  const codeScrollRef = useRef<ScrollView>(null);
const previewScrollRef = useRef<ScrollView>(null);
const isSyncingScroll = useRef(false);
 const { user, isGuest, isPro } = useAuth();
  const router = useRouter();
 const [selectedLine, setSelectedLine] = useState<number | null>(null);
 const [insertLineText, setInsertLineText] = useState('G1 X0 Y0');
const [fileContent, setFileContent] = useState<string[]>([]);
const [lineEndings, setLineEndings] = useState<string[]>([]);
const [hasUtf8Bom, setHasUtf8Bom] = useState(false);
const [history, setHistory] = useState<TextDocument[]>([]);
const [fileName, setFileName] = useState('');

const currentDocument = (): TextDocument => ({
  lines: fileContent,
  endings: lineEndings,
  hasUtf8Bom,
});

const [zoom, setZoom] = useState(1);
const [panX, setPanX] = useState(0);
const [panY, setPanY] = useState(0);
const [isDragging, setIsDragging] = useState(false);
const [lastX, setLastX] = useState(0);
const [lastY, setLastY] = useState(0);
const [editX, setEditX] = useState('');
const [editY, setEditY] = useState('');
const [editG, setEditG] = useState('');
const [editI, setEditI] = useState('');
const [editJ, setEditJ] = useState('');
const [scrollLocked, setScrollLocked] = useState(false);
const [showLineIds, setShowLineIds] = useState(false);

const selectSourceLine = (line: number) => {
  const values = readMotionBlockValues(fileContent, line);
  setSelectedLine(line);
  setEditG(values.G ?? '');
  setEditX(values.X ?? '');
  setEditY(values.Y ?? '');
  setEditI(values.I ?? '');
  setEditJ(values.J ?? '');
  codeScrollRef.current?.scrollTo({
    y: Math.max(0, line * 24 - 72),
    animated: true,
  });
};

let selectedText = '';

if (selectedLine !== null) {
  let start = selectedLine;

  while (start > 0 && !fileContent[start].match(/^G0?[0123]/)) {
    start--;
  }

  selectedText = fileContent[start] || '';

  for (let i = start + 1; i < fileContent.length; i++) {
    const next = fileContent[i] || '';

    if (next.match(/^G0?[0123]/)) break

    selectedText += ' ' + next;
  }
}

const toolpath: ToolpathPoint[] = interpretToolpath(fileContent);
const parsedCoords = selectedLine === null
  ? null
  : [...toolpath]
      .reverse()
      .find(point => point.line !== undefined && point.line <= selectedLine) ?? { x: 0, y: 0 };
  const cleanPoints = toolpath.filter(p => !Number.isNaN(p.x) && !Number.isNaN(p.y));
  
const xs = cleanPoints.map(p => p.x);
const ys = cleanPoints.map(p => p.y);

const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const minY = Math.min(...ys);
const maxY = Math.max(...ys);

const width = maxX - minX || 1;
const height = maxY - minY || 1;

const scale = Math.min(200 / width, 200 / height);


return (
   
  <ScrollView
  scrollEnabled={!scrollLocked}
  style={styles.container}
  contentContainerStyle={{ paddingBottom: 240 }}
  keyboardShouldPersistTaps="handled"
>
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
  console.log('PICKER RESULT:', JSON.stringify(result, null, 2));

  if (!result.canceled) {
  const file = result.assets[0];

  if (file.uri) {
  const response = await fetch(file.uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const container = detectContainer(bytes);

  if (container === 'dwg') {
    Alert.alert(
      'DWG-based CNC file recognized',
      'This file uses an AutoCAD DWG container. MAB preserved the requirement, but safe DWG editing/export is not enabled yet.'
    );
    return;
  }

  if (container !== 'text') {
    Alert.alert(
      'Binary CNC format recognized',
      'MAB does not yet have a verified round-trip codec for this binary format.'
    );
    return;
  }

  try {
    const document = decodeTextDocument(bytes);
    setFileName(file.name || 'Imported file');
    setFileContent(document.lines);
    setLineEndings(document.endings);
    setHasUtf8Bom(document.hasUtf8Bom);
    setHistory([]);
    setSelectedLine(null);
  } catch {
    Alert.alert(
      'Unsupported text encoding',
      'This controller program is not valid UTF-8. MAB left the source file unchanged.'
    );
  }

  }
}
}}
    >
      <Ionicons name="cloud-upload-outline" size={28} color="#fff" />
      <Text style={styles.primaryText}>Import CNC File</Text>
    </TouchableOpacity>
{fileName !== '' && (
  <ScrollView
  ref={codeScrollRef}
  style={[styles.panel, { maxHeight: 400 }]}
  onScroll={(e) => {
    if (!scrollLocked || isSyncingScroll.current) return;

    isSyncingScroll.current = true;

    previewScrollRef.current?.scrollTo({
      y: e.nativeEvent.contentOffset.y,
      animated: false,
    });

    isSyncingScroll.current = false;
  }}
  scrollEventThrottle={16}
>
    {fileContent.map((line, i) => {
      return (
        <View key={i}>
          <Text
            onPress={() => selectSourceLine(i)}
            style={[
              styles.panelText,
              line.includes('G') && { color: '#4FC3F7' },
              selectedLine === i && { backgroundColor: '#333' },
            ]}
          >
            {i + 1}. {line}
          </Text>
        </View>
      );
    })}
  </ScrollView>
)}

<TouchableOpacity
  style={[
    styles.secondaryButton,
    scrollLocked && { backgroundColor: '#4FC3F7' },
  ]}
  onPress={() => setScrollLocked(!scrollLocked)}
>
  <Text style={styles.primaryText}>
    {scrollLocked ? '🔒 Scroll Locked' : '🔓 Scroll Free'}
  </Text>
</TouchableOpacity>


  
<View style={styles.panel}>
  <View style={styles.previewHeader}>
    <Text style={styles.panelTitle}>Preview</Text>
    <TouchableOpacity
      accessibilityRole="switch"
      accessibilityState={{ checked: showLineIds }}
      style={[styles.idToggle, showLineIds && styles.idToggleActive]}
      onPress={() => setShowLineIds(value => !value)}
    >
      <Text style={styles.idToggleText}>
        {showLineIds ? 'Line IDs On' : 'Show Line IDs'}
      </Text>
    </TouchableOpacity>
  </View>
  <View style={styles.legend}>
    {([
      ['#FF9F0A', 'Rapid'],
      ['#35D0E5', 'Cut'],
      ['#64D2FF', 'CW arc'],
      ['#5E5CE6', 'CCW arc'],
      ['#FF453A', 'Pierce'],
    ] as const).map(([color, label]) => (
      <View key={label} style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label}</Text>
      </View>
    ))}
  </View>
  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
  <TouchableOpacity style={styles.primaryButton} onPress={() => setZoom(Math.max(0.5, zoom - 0.5))}>
    <Text style={styles.primaryText}>Zoom -</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.primaryButton} onPress={() => setZoom(zoom + 0.5)}>
    <Text style={styles.primaryText}>Zoom +</Text>
  </TouchableOpacity>

  <Text style={styles.panelText}>Zoom: {zoom}x</Text>
</View>
<ScrollView
  ref={previewScrollRef}
  scrollEnabled={true}
  nestedScrollEnabled={true}
  
  onMoveShouldSetResponder={() => true}
  
  onScroll={(e) => {
    if (!scrollLocked || isSyncingScroll.current) return;

    isSyncingScroll.current = true;

    codeScrollRef.current?.scrollTo({
      y: e.nativeEvent.contentOffset.y,
      animated: false,
    });

    isSyncingScroll.current = false;
  }}
  scrollEventThrottle={16}
  style={{ height: 200, maxHeight: 200, backgroundColor: '#111', overflow: 'hidden' }}
  onStartShouldSetResponder={() => false}
  onResponderGrant={(e) => {
    setIsDragging(true);
    setLastX(e.nativeEvent.pageX);
    setLastY(e.nativeEvent.pageY);
  }}
  onResponderMove={(e) => {
    if (!isDragging) return;

    const dx = e.nativeEvent.pageX - lastX;
    const dy = e.nativeEvent.pageY - lastY;

    setPanX(panX + dx);
    setPanY(panY + dy);

    setLastX(e.nativeEvent.pageX);
    setLastY(e.nativeEvent.pageY);
  }}
  onResponderRelease={() => setIsDragging(false)}
>
   {toolpath.map((point, i) => {
  if (i === 0) return null;

  const prev = toolpath[i - 1];
  if (
  Number.isNaN(point.x) ||
  Number.isNaN(point.y) ||
  Number.isNaN(prev.x) ||
  Number.isNaN(prev.y)
) {
  return null;
}

  // 🔹 SCALE DOWN (key change)
  const scale = 6 * zoom;

  const x1 = (prev.x - minX) * scale;
  const y1 = (prev.y - minY) * scale;


const x2 = (point.x - minX) * scale;
const y2 = (point.y - minY) * scale;

  const dx = x2 - x1;
  const dy = y2 - y1;

  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  const isSelected = point.line === selectedLine;
  const color = point.mode ? movementColor[point.mode] : '#35D0E5';

  return (
    <React.Fragment key={i}>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={point.line === undefined
        ? 'Toolpath movement'
        : `Select source line ${point.line + 1}`}
      activeOpacity={0.7}
      disabled={point.line === undefined}
      onPress={() => point.line !== undefined && selectSourceLine(point.line)}
      style={{
        position: 'absolute',
        left: x1 + (200 - width * scale) / 2 + panX,
        top: y1 + (200 - height * scale) / 2 + panY - 6,
        width: length,
        height: 14,
        borderTopColor: isSelected ? '#FFD60A' : color,
        borderTopWidth: isSelected ? 4 : 2,
        borderStyle: point.mode === 'G00' ? 'dashed' : 'solid',
        paddingVertical: 6,
        transform: [{ rotate: `${angle}deg` }],
        transformOrigin: 'left center',
      }}
    />
    {point.pierce && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Pierce at source line ${(point.line ?? 0) + 1}`}
        onPress={() => point.line !== undefined && selectSourceLine(point.line)}
        style={[
          styles.pierceMarker,
          {
            left: x1 + (200 - width * scale) / 2 + panX - 5,
            top: y1 + (200 - height * scale) / 2 + panY - 5,
          },
        ]}
      />
    )}
    {showLineIds && point.commandEnd && point.line !== undefined && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Select source line ${point.line + 1}`}
        onPress={() => selectSourceLine(point.line!)}
        style={[
          styles.lineIdBadge,
          {
            left: x2 + (200 - width * scale) / 2 + panX + 4,
            top: y2 + (200 - height * scale) / 2 + panY - 9,
          },
          isSelected && styles.lineIdBadgeSelected,
        ]}
      >
        <Text style={styles.lineIdText}>{point.line + 1}</Text>
      </TouchableOpacity>
    )}
    </React.Fragment>
  );
})}
      
  </ScrollView>
</View>

<View style={styles.panel}>
  <Text style={styles.panelTitle}>G-Code</Text>

  <Text style={styles.inspectNotice}>
    {selectedLine !== null
      ? `Inspecting Line ${selectedLine + 1} — selection does not modify code.`
      : 'Select a code line or preview movement to inspect it. Selection does not modify code.'}
  </Text>

  <ScrollView
  ref={codeScrollRef}
  scrollEnabled={true}
  nestedScrollEnabled={true}
  onStartShouldSetResponder={() => true}
  onMoveShouldSetResponder={() => true}
  style={{ maxHeight: 180 }}
>
    <Text style={styles.panelText}>
      {selectedLine !== null
        ? fileContent[selectedLine]
        : 'Select a line above'}
    </Text>
  </ScrollView>

  <Text style={styles.panelText}>
    X: {parsedCoords ? parsedCoords.x : '-'}
    Y: {parsedCoords ? parsedCoords.y : '-'}
  </Text>
</View>
  

<Text style={styles.panelText}>
  X:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editX}
    onChangeText={setEditX}
  />
</Text>

<Text style={styles.panelText}>
  Y:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editY}
    onChangeText={setEditY}
  />
</Text>

<Text style={styles.panelText}>
  G:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editG}
    onChangeText={setEditG}
  />
</Text>

<Text style={styles.panelText}>
  I:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editI}
    onChangeText={setEditI}
  />
</Text>

<Text style={styles.panelText}>
  J:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editJ}
    onChangeText={setEditJ}
  />
</Text>

<TouchableOpacity
  style={[styles.primaryButton, { backgroundColor: '#4FC3F7' }]}
  onPress={async () => {
if (isGuest || !user || !isPro) {
  router.push('/upgrade');
  return;
}
   try {
  const sourceDocument = currentDocument();
  const content = serializeTextDocument(sourceDocument);
  const encoded = encodeTextDocument(sourceDocument);
  const exportBytes = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  ) as ArrayBuffer;
  const exportName = fileName || 'edited-program.gcode';

  if (Platform.OS === 'web') {
    const blob = new Blob([exportBytes], { type: 'application/octet-stream' });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = downloadUrl;
    link.download = exportName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  } else {
    const fileUri =
      FileSystem.documentDirectory + exportName;

    await FileSystem.writeAsStringAsync(
      fileUri,
      (hasUtf8Bom ? '\uFEFF' : '') + content
    );
    await Sharing.shareAsync(fileUri);
  }
} catch (err) {
  console.error('Export failed:', err);
  alert('Export failed');
}
  }}
>
  <Text style={styles.primaryText}>Export</Text>
</TouchableOpacity>

<TouchableOpacity
  style={styles.primaryButton}
  onPress={() => {
    if (selectedLine === null) return;

    const before = currentDocument();
    const updated = patchMotionBlock(fileContent, selectedLine, {
      X: editX,
      Y: editY,
      G: editG,
      I: editI,
      J: editJ,
    });

    if (updated.every((line, index) => line === fileContent[index])) return;

    setHistory(prev => [...prev, before]);
    setFileContent(updated);
  }}
>
  <Text style={styles.primaryText}>Apply</Text>
</TouchableOpacity> 




<TouchableOpacity
  style={[styles.primaryButton, { backgroundColor: 'red', marginTop: 12 }]}
  onPress={() => {
    if (history.length === 0) return;

    const last = history[history.length - 1];

    setFileContent(last.lines);
    setLineEndings(last.endings);
    setHasUtf8Bom(last.hasUtf8Bom);
    setHistory(history.slice(0, -1));
  }}
>
  <Text style={styles.primaryText}>Undo</Text>
</TouchableOpacity>
<TouchableOpacity
  style={styles.primaryButton}
  onPress={() => {
    if (isGuest || !user) {
  Alert.alert(
    'Account required',
    'Please create an account to use production editing features.'
  );
  return;
}
    const newLines = [...fileContent];

    const insertAt =
      selectedLine === null
        ? newLines.length
        : selectedLine + 1;

   const newEndings = [...lineEndings];
   const preferredEnding = lineEndings.find(ending => ending !== '') || '\n';
   const insertedLines = [
     'G03',
     'X0',
     'Y0',
     'I0',
     'J0'
   ];

   newLines.splice(
  insertAt,
  0,
  ...insertedLines
);

    if (insertAt === fileContent.length && fileContent.length > 0 && newEndings[fileContent.length - 1] === '') {
      newEndings[fileContent.length - 1] = preferredEnding;
    }
    const insertedEndings = insertedLines.map((_, index) =>
      insertAt === fileContent.length && index === insertedLines.length - 1
        ? ''
        : preferredEnding
    );
    newEndings.splice(insertAt, 0, ...insertedEndings);

    setHistory([...history, currentDocument()]);
    setFileContent(newLines);
    setLineEndings(newEndings);
    selectSourceLine(insertAt);
  }}
>
  <Text style={styles.primaryText}>Add Line</Text>
</TouchableOpacity>
<TouchableOpacity
  style={styles.primaryButton}
  onPress={async () => {
if (isGuest || !user || !isPro) {
  router.push('/upgrade');
  return;
}

  await Clipboard.setStringAsync(serializeTextDocument(currentDocument()));
}}
>
  <Text style={styles.primaryText}>Copy G-code</Text>
</TouchableOpacity>
  </ScrollView>
);
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 24,
    gap: 16,
    paddingBottom: 80,
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
    
    alignItems: 'center',
    gap: 12,

  },
secondaryButton: {
  padding: 12,
  borderRadius: 8,
  backgroundColor: '#333',
  alignItems: 'center',
  marginVertical: 8,
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
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  idToggle: {
    backgroundColor: '#333',
    borderColor: '#555',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  idToggleActive: {
    backgroundColor: '#0A84FF',
    borderColor: '#64D2FF',
  },
  idToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendSwatch: {
    width: 12,
    height: 3,
    borderRadius: 2,
  },
  legendText: {
    color: '#aaa',
    fontSize: 11,
  },
  pierceMarker: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF453A',
    borderColor: '#fff',
    borderWidth: 1,
    zIndex: 3,
  },
  lineIdBadge: {
    position: 'absolute',
    minWidth: 20,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 28, 30, 0.9)',
    borderColor: '#666',
    borderWidth: 1,
    zIndex: 4,
  },
  lineIdBadgeSelected: {
    borderColor: '#FFD60A',
    backgroundColor: 'rgba(90, 75, 0, 0.95)',
  },
  lineIdText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  inspectNotice: {
    color: '#C7C7CC',
    fontSize: 12,
    marginBottom: 10,
  },

});
