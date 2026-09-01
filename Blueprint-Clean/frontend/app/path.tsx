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
  importControllerDocument,
  encodeTextDocument,
  interpretToolpath,
  readSourceLineValues,
  coordinateDescription,
  serializeTextDocument,
  type TextDocument,
  type InterpretedPoint,
} from '../utils/gcodeDocument';
import { fitPreview, selectedMoveMeasurements } from '../utils/previewGeometry';
import InsertMotionDialog from '../components/InsertMotionDialog';
import ProgramSettings from '../components/ProgramSettings';
import { reviewMeasurementEdit } from '../utils/measurementEdit';

type MovementMode = 'G00' | 'G01' | 'G02' | 'G03';

const movementColor: Record<MovementMode, string> = {
  G00: '#FF9F0A',
  G01: '#35D0E5',
  G02: '#35D0E5',
  G03: '#35D0E5',
};

export default function Path() {
  const codeScrollRef = useRef<ScrollView>(null);
const previewScrollRef = useRef<ScrollView>(null);
const isSyncingScroll = useRef(false);
 const { user, isGuest, isPro, checkoutMessage } = useAuth();
  const router = useRouter();
 const [selectedLine, setSelectedLine] = useState<number | null>(null);
const [fileContent, setFileContent] = useState<string[]>([]);
const [lineEndings, setLineEndings] = useState<string[]>([]);
const [hasUtf8Bom, setHasUtf8Bom] = useState(false);
const [history, setHistory] = useState<TextDocument[]>([]);
const [fileName, setFileName] = useState('');
const [importError, setImportError] = useState('');
const [editError, setEditError] = useState('');
const [insertionAfter, setInsertionAfter] = useState<number | null>(null);
const [previewWidth, setPreviewWidth] = useState(320);

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
  const values = readSourceLineValues(fileContent[line] ?? '');
  setEditError('');
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

const toolpath: InterpretedPoint[] = interpretToolpath(fileContent);
const preview = fitPreview(toolpath, previewWidth, 240, zoom, panX, panY);
const origin = preview.project({ x: 0, y: 0 });
const measured = selectedLine === null ? null : selectedMoveMeasurements(toolpath, selectedLine);
const movementLines = [...new Set(toolpath.filter(point => point.commandEnd && point.line !== undefined).map(point => point.line!))];
const previousMove = movementLines.filter(line => line < (selectedLine ?? 0)).pop();
const nextMove = movementLines.find(line => line > (selectedLine ?? -1));
const signed = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(4))}`;
let measurementDraft: ReturnType<typeof reviewMeasurementEdit> | undefined;
let measurementDraftError = '';
if (selectedLine !== null) {
  try { measurementDraft = reviewMeasurementEdit(fileContent, selectedLine, { X: editX, Y: editY, G: editG, I: editI, J: editJ }); }
  catch (error) { measurementDraftError = error instanceof Error ? error.message : 'Measurements unavailable.'; }
}


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

  if (!result.canceled) {
  const file = result.assets[0];

  if (file.uri) {
  try {
  const response = await fetch(file.uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
    const document = importControllerDocument(bytes);
    setFileName(file.name || 'Imported file');
    setImportError('');
    setFileContent(document.lines);
    setLineEndings(document.endings);
    setHasUtf8Bom(document.hasUtf8Bom);
    setHistory([]);
    setSelectedLine(null);
    setZoom(1); setPanX(0); setPanY(0);
    setEditX(''); setEditY(''); setEditG(''); setEditI(''); setEditJ(''); setEditError('');
  } catch (error) {
    setImportError(error instanceof Error ? error.message : 'Could not read this file. The current document and source are unchanged.');
  }

  }
}
}}
    >
      <Ionicons name="cloud-upload-outline" size={28} color="#fff" />
      <Text style={styles.primaryText}>Import CNC File</Text>
    </TouchableOpacity>
{importError !== '' && <Text accessibilityRole="alert" style={{ color: '#FF9F0A' }}>{importError}</Text>}
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
  <Text style={styles.legendHeading}>Primary process role</Text>
  <View style={styles.legend}>
    {([
      ['#FF9F0A', 'Rapid'],
      ['#FF453A', 'Pierce'],
      ['#8E8E93', 'Lead-in (when encoded)'],
      ['#35D0E5', 'Cut'],
      ['#8E8E93', 'Lead-out (when encoded)'],
    ] as const).map(([color, label]) => (
      <View key={label} style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label}</Text>
      </View>
    ))}
  </View>
  <Text style={styles.legendHeading}>Cut geometry subtype</Text>
  <View style={styles.legend}>
    <Text style={styles.legendText}>━━ Straight</Text>
    <Text style={styles.legendText}>┄┄ ↻ CW arc</Text>
    <Text style={styles.legendText}>┈┈ ↺ CCW arc</Text>
  </View>
  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
  <TouchableOpacity style={styles.primaryButton} onPress={() => setZoom(Math.max(0.5, zoom - 0.5))}>
    <Text style={styles.primaryText}>Zoom -</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.primaryButton} onPress={() => setZoom(zoom + 0.5)}>
    <Text style={styles.primaryText}>Zoom +</Text>
  </TouchableOpacity>

  <Text style={styles.panelText}>Zoom: {zoom}x</Text>
  <TouchableOpacity accessibilityRole="button" style={{ padding: 12, backgroundColor: '#333', borderRadius: 8 }} onPress={() => { setZoom(1); setPanX(0); setPanY(0); }}>
    <Text style={styles.panelText}>Fit drawing</Text>
  </TouchableOpacity>
</View>
<Text style={styles.panelText}>X {signed(preview.minX)} to {signed(preview.maxX)} | Y {signed(preview.minY)} to {signed(preview.maxY)} · +X right, +Y up</Text>
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
  onLayout={event => setPreviewWidth(event.nativeEvent.layout.width)}
  style={{ height: 240, maxHeight: 240, backgroundColor: '#111', overflow: 'hidden' }}
  contentContainerStyle={{ height: 240 }}
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
   <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: origin.y, width: previewWidth, borderTopWidth: 1, borderColor: '#555' }} />
   <View pointerEvents="none" style={{ position: 'absolute', left: origin.x, top: 0, height: 240, borderLeftWidth: 1, borderColor: '#555' }} />
   <Text pointerEvents="none" style={{ position: 'absolute', left: origin.x + 4, top: origin.y + 4, color: '#aaa', fontSize: 10 }}>0,0</Text>
   {toolpath.map((point, i) => {
  if (i === 0) return null;

  const prev = toolpath[i - 1];
  if (
  !Number.isFinite(point.x) ||
  !Number.isFinite(point.y) ||
  !Number.isFinite(prev.x) ||
  !Number.isFinite(prev.y)
) {
  return null;
}

  const { x: x1, y: y1 } = preview.project(prev);
  const { x: x2, y: y2 } = preview.project(point);

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
        left: x1,
        top: y1 - 7,
        width: length,
        height: 14,
        transform: [{ rotate: `${angle}deg` }],
        transformOrigin: 'left center',
      }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 7, width: length, borderTopColor: isSelected ? '#FFD60A' : color, borderTopWidth: isSelected ? 4 : 2, borderStyle: point.mode === 'G00' || point.geometry === 'arc-cw' ? 'dashed' : point.geometry === 'arc-ccw' ? 'dotted' : 'solid' }} />
    </TouchableOpacity>
    {point.pierce && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Pierce at source line ${(point.line ?? 0) + 1}`}
        onPress={() => point.line !== undefined && selectSourceLine(point.line)}
        style={[
          styles.pierceMarker,
          {
            left: x1 - 5,
            top: y1 - 5,
          },
        ]}
      />
    )}
    {point.commandEnd && (point.geometry === 'arc-cw' || point.geometry === 'arc-ccw') && (
      <Text
        pointerEvents="none"
        accessibilityLabel={`Cut ${point.geometry === 'arc-cw' ? 'clockwise' : 'counterclockwise'} arc direction`}
        style={[styles.arcDirection, { left: x2 - 6, top: y2 - 18 }]}
      >
        {point.geometry === 'arc-cw' ? '↻' : '↺'}
      </Text>
    )}
    {showLineIds && point.commandEnd && point.line !== undefined && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Select source line ${point.line + 1}`}
        onPress={() => selectSourceLine(point.line!)}
        style={[
          styles.lineIdBadge,
          {
            left: x2 + 4,
            top: y2 - 9,
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

  <Text style={styles.panelText}>{coordinateDescription(fileContent, selectedLine ?? fileContent.length - 1)}</Text>
  <Text style={styles.inspectNotice}>Preview coordinates, not verified machine position. Origin/undeclared modes follow preview defaults. Edit fields below are literal values on this source line.</Text>
  {measured ? <Text style={styles.panelText}>
    Start X {signed(measured.start.x)}  Y {signed(measured.start.y)}{'\n'}
    End X {signed(measured.end.x)}  Y {signed(measured.end.y)}{'\n'}
    ΔX {signed(measured.dx)}  ΔY {signed(measured.dy)}{'\n'}
    Endpoint distance {Number(measured.endpointDistance.toFixed(4))}{measured.mode === 'G02' || measured.mode === 'G03' ? ' (chord, not arc length)' : ''}
  </Text> : <Text style={styles.panelText}>No preview movement on the selected source line.</Text>}
  <TouchableOpacity accessibilityRole="button" disabled={previousMove === undefined} onPress={() => previousMove !== undefined && selectSourceLine(previousMove)}><Text style={styles.panelText}>Previous move</Text></TouchableOpacity>
  <TouchableOpacity accessibilityRole="button" disabled={nextMove === undefined} onPress={() => nextMove !== undefined && selectSourceLine(nextMove)}><Text style={styles.panelText}>Next move</Text></TouchableOpacity>
</View>
{editError !== '' && <Text accessibilityRole="alert" style={{ color: '#FF9F0A' }}>{editError}</Text>}
<ProgramSettings lines={fileContent} onSelect={selectSourceLine} />
{checkoutMessage !== '' && <Text accessibilityRole="alert" style={styles.panelText}>{checkoutMessage}</Text>}
<Text style={styles.panelText}>Edit line measurements — X/Y are source endpoint words (increments in G91); I/J are source arc-center words. Use your normal device input. Review the numerical result below before Apply.</Text>
{measurementDraft && <Text accessibilityLabel="Draft line measurements" style={styles.panelText}>
  Draft start X {measurementDraft.start.x} Y {measurementDraft.start.y}{'\n'}
  Draft end X {measurementDraft.end.x} Y {measurementDraft.end.y}{'\n'}
  Draft ΔX {measurementDraft.dx} ΔY {measurementDraft.dy}{'\n'}
  Source after Apply: {measurementDraft.source}{'\n'}
  Uses the displayed coordinate modes and preview assumptions, not verified machine position. Following movement may start at this new endpoint.
</Text>}
{measurementDraftError !== '' && <Text accessibilityRole="alert" style={styles.panelText}>{measurementDraftError}</Text>}
  

<Text style={styles.panelText}>
  X:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editX}
    accessibilityLabel="Source X"
    onChangeText={setEditX}
  />
</Text>

<Text style={styles.panelText}>
  Y:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editY}
    accessibilityLabel="Source Y"
    onChangeText={setEditY}
  />
</Text>

<Text style={styles.panelText}>
  G:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editG}
    accessibilityLabel="Source G motion"
    onChangeText={setEditG}
  />
</Text>

<Text style={styles.panelText}>
  I:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editI}
    accessibilityLabel="Source I"
    onChangeText={setEditI}
  />
</Text>

<Text style={styles.panelText}>
  J:
  <TextInput
    style={{ color: 'white', borderBottomWidth: 1, borderColor: 'white', minWidth: 60 }}
    value={editJ}
    accessibilityLabel="Source J"
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
    const updated = [...fileContent];
    try {
    updated[selectedLine] = reviewMeasurementEdit(fileContent, selectedLine, {
      X: editX,
      Y: editY,
      G: editG,
      I: editI,
      J: editJ,
    }).source;
    setEditError('');
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Edit could not be validated.');
      return;
    }

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
    if (selectedLine !== null) {
      const values = readSourceLineValues(last.lines[selectedLine] ?? '');
      setEditX(values.X ?? ''); setEditY(values.Y ?? ''); setEditG(values.G ?? ''); setEditI(values.I ?? ''); setEditJ(values.J ?? '');
    }
    setEditError('');
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
    if (selectedLine === null) { setEditError('Select a source line before adding a movement.'); return; }
    setInsertionAfter(selectedLine);
  }}
>
  <Text style={styles.primaryText}>Add Line</Text>
</TouchableOpacity>
{insertionAfter !== null && <InsertMotionDialog document={currentDocument()} after={insertionAfter} onCancel={() => setInsertionAfter(null)} onApply={next => {
  if (isGuest || !user) { setInsertionAfter(null); return; }
  setHistory([...history, currentDocument()]);
  setFileContent(next.lines); setLineEndings(next.endings); setHasUtf8Bom(next.hasUtf8Bom);
  // Keep selection on the original line so both Apply and Undo retain the same source scope.
  setInsertionAfter(null); setEditError('');
}} />}
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
    color: '#D1D1D6',
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
  legendHeading: {
    color: '#F2F2F7',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 3,
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
  arcDirection: {
    position: 'absolute',
    color: '#35D0E5',
    fontSize: 16,
    fontWeight: '700',
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
