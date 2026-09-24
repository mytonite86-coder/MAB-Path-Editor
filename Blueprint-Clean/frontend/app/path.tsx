import React, { useEffect, useState, useRef } from 'react';

import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  useWindowDimensions,
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
  interpretStructuredToolpath,
  reconstructProgramStructure,
  readSourceLineValues,
  coordinateDescription,
  serializeTextDocument,
  type TextDocument,
  type InterpretedPoint,
} from '../utils/gcodeDocument';
import { fitPreview, selectedMoveMeasurements } from '../utils/previewGeometry';
import InsertMotionDialog from '../components/InsertMotionDialog';
import ProgramSettings from '../components/ProgramSettings';
import NestingWorkspace from '../components/NestingWorkspace';
import { reviewMeasurementEdit } from '../utils/measurementEdit';
import { messerProgrammedNestProfile } from '../utils/messerProgrammedNest';
import { rotateVerifiedProgramPart } from '../utils/programPartRotation';

type MovementMode = 'G00' | 'G01' | 'G02' | 'G03';

const movementColor: Record<MovementMode, string> = {
  G00: '#FF9F0A',
  G01: '#35D0E5',
  G02: '#35D0E5',
  G03: '#35D0E5',
};

export default function Path() {
  const { width: viewportWidth } = useWindowDimensions();
  const isCompact = viewportWidth < 560;
  const codeScrollRef = useRef<ScrollView>(null);
const previewScrollRef = useRef<ScrollView>(null);
const isSyncingScroll = useRef(false);
 const { user, isGuest, isPro, checkoutMessage } = useAuth();
  const router = useRouter();
 const [selectedLine, setSelectedLine] = useState<number | null>(null);
const [fileContent, setFileContent] = useState<string[]>([]);
const [lineEndings, setLineEndings] = useState<string[]>([]);
const [hasUtf8Bom, setHasUtf8Bom] = useState(false);
const [sourceKind, setSourceKind] = useState<TextDocument['sourceKind']>('controller-text');
const [importedPreview, setImportedPreview] = useState<InterpretedPoint[]>([]);
const [unsupportedEntities, setUnsupportedEntities] = useState<Record<string, number>>({});
const [resolvedBlocks, setResolvedBlocks] = useState<string[]>([]);
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
const [editorMode, setEditorMode] = useState<'line' | 'part'>('line');
const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
const selectedPartRef = useRef<string | null>(null);
const documentRef = useRef<TextDocument>({ lines: [], endings: [], hasUtf8Bom: false });
const holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const holdRepeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
const holdAppliedRef = useRef(false);
documentRef.current = currentDocument();
useEffect(() => () => {
  if (holdDelayRef.current) clearTimeout(holdDelayRef.current);
  if (holdRepeatRef.current) clearInterval(holdRepeatRef.current);
}, []);

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

const programStructure = sourceKind === 'controller-text' && fileContent.length
  ? reconstructProgramStructure(fileContent, messerProgrammedNestProfile)
  : reconstructProgramStructure([]);
const partModeAvailable = programStructure.status === 'verified';
const toolpath: InterpretedPoint[] = sourceKind === 'dxf'
  ? importedPreview
  : partModeAvailable
    ? interpretStructuredToolpath(fileContent, programStructure)
    : interpretToolpath(fileContent);

const selectPreviewPoint = (point: InterpretedPoint) => {
  if (editorMode === 'part') {
    const partId = point.programPartId ?? null;
    setSelectedPartId(partId);
    selectedPartRef.current = partId;
    setEditError(partId ? '' : 'This geometry has no verified ProgramPart identity.');
    return;
  }
  if (point.line !== undefined) selectSourceLine(point.line);
};

const rotateSelectedPart = (degrees: number, addUndo: boolean) => {
  const partId = selectedPartRef.current;
  if (!partId) { setEditError('Select a verified whole part before rotating.'); return false; }
  try {
    const before = documentRef.current;
    const structure = reconstructProgramStructure(before.lines, messerProgrammedNestProfile);
    const next = rotateVerifiedProgramPart(before, structure, partId, degrees);
    if (addUndo) setHistory(previous => [...previous, before]);
    documentRef.current = next;
    setFileContent(next.lines);
    setEditError('');
    return true;
  } catch (error) {
    setEditError(error instanceof Error ? error.message : 'Selected part could not be rotated safely.');
    return false;
  }
};

const beginRotation = (degrees: number) => {
  if (!selectedPartRef.current) { setEditError('Select a verified whole part before rotating.'); return; }
  holdAppliedRef.current = false;
  holdDelayRef.current = setTimeout(() => {
    holdAppliedRef.current = true;
    const before = documentRef.current;
    if (!rotateSelectedPart(degrees, false)) return;
    setHistory(previous => [...previous, before]);
    holdRepeatRef.current = setInterval(() => rotateSelectedPart(degrees, false), 90);
  }, 350);
};

const endRotation = (degrees: number) => {
  if (holdDelayRef.current) clearTimeout(holdDelayRef.current);
  if (holdRepeatRef.current) clearInterval(holdRepeatRef.current);
  holdDelayRef.current = null;
  holdRepeatRef.current = null;
  if (!holdAppliedRef.current) rotateSelectedPart(degrees, true);
  holdAppliedRef.current = false;
};
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
  contentContainerStyle={[styles.content, isCompact && styles.contentCompact]}
  keyboardShouldPersistTaps="handled"
>
    <View style={styles.pageHeader}>
      <View style={styles.headingIcon}>
        <Ionicons name="settings-outline" size={25} color="#0A84FF" />
      </View>
      <View style={styles.headingCopy}>
        <Text style={styles.title}>Path Edit</Text>
        <Text style={styles.subtitle}>Import, inspect, adjust, and preview your CNC toolpath.</Text>
      </View>
      <Ionicons name="help-circle-outline" size={27} color="#0A84FF" />
    </View>

    <View style={[styles.primaryActions, isCompact && styles.primaryActionsCompact]}>
      <View style={styles.primaryActionSlot}>
        <NestingWorkspace canExport={!isGuest && !!user && isPro} onUpgrade={() => router.push('/upgrade')} />
      </View>
      <TouchableOpacity
      accessibilityRole="button"
      style={[styles.primaryButton, styles.importButton]}
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
    setSourceKind(document.sourceKind ?? 'controller-text');
    setImportedPreview(document.previewGeometry ?? []);
    setUnsupportedEntities(document.unsupportedEntities ?? {});
    setResolvedBlocks(document.resolvedBlocks ?? []);
    setHistory([]);
    setSelectedLine(null);
    setEditorMode('line');
    setSelectedPartId(null); selectedPartRef.current = null;
    setZoom(1); setPanX(0); setPanY(0);
    setEditX(''); setEditY(''); setEditG(''); setEditI(''); setEditJ(''); setEditError('');
  } catch (error) {
    setImportError(error instanceof Error ? error.message : 'Could not read this file. The current document and source are unchanged.');
  }

  }
}
}}
    >
      <Ionicons name="cloud-upload-outline" size={30} color="#fff" />
      <Text style={styles.primaryText}>Import CNC File</Text>
      <Text style={styles.actionHint}>.nc  .tap  .gcode  .txt</Text>
    </TouchableOpacity>
    </View>
{importError !== '' && <Text accessibilityRole="alert" style={{ color: '#FF9F0A' }}>{importError}</Text>}
{sourceKind === 'dxf' && <Text accessibilityRole="text" style={{ color: '#FF9F0A' }}>
  DXF preview resolved {resolvedBlocks.length ? resolvedBlocks.join(', ') : 'top-level geometry'}. Preview-only: DXF geometry editing is not enabled.
  {Object.keys(unsupportedEntities).length ? ` Unsupported and not rendered: ${Object.entries(unsupportedEntities).map(([type, count]) => `${count} ${type}`).join(', ')}.` : ''}
</Text>}
<TouchableOpacity
  style={[
    styles.scrollControl,
    scrollLocked && styles.scrollControlActive,
  ]}
  onPress={() => setScrollLocked(!scrollLocked)}
>
  <Text style={styles.scrollControlText}>
    {scrollLocked ? '🔒 Scroll Locked' : '🔓 Scroll Free'}
  </Text>
</TouchableOpacity>


  
<View style={[styles.panel, styles.previewPanel]}>
  <View style={styles.previewHeader}>
    <View style={styles.sectionHeading}>
      <Ionicons name="eye-outline" size={24} color="#0A84FF" />
      <Text style={styles.panelTitle}>Preview</Text>
    </View>
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
  {sourceKind === 'controller-text' && fileContent.length > 0 && <>
    <View style={styles.partControlRow}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Rotate selected part counterclockwise"
        disabled={editorMode !== 'part' || !selectedPartId}
        style={[styles.rotationButton, (editorMode !== 'part' || !selectedPartId) && styles.partControlDisabled]}
        onPressIn={() => beginRotation(-1)}
        onPressOut={() => endRotation(-1)}
      ><Text style={styles.rotationButtonText}>↺ CCW</Text></TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="switch"
        accessibilityState={{ checked: editorMode === 'part', disabled: !partModeAvailable }}
        style={[styles.modeButton, editorMode === 'part' && styles.modeButtonActive, !partModeAvailable && styles.partControlDisabled]}
        onPress={() => {
          if (!partModeAvailable) { setEditError('PART mode is unavailable because this program has no verified ProgramPart identity.'); return; }
          const next = editorMode === 'line' ? 'part' : 'line';
          setEditorMode(next);
          if (next === 'line') { setSelectedPartId(null); selectedPartRef.current = null; }
          setEditError('');
        }}
      ><Text style={styles.modeButtonText}>{editorMode === 'line' ? 'LINE | PART' : 'LINE | PART ✓'}</Text></TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Rotate selected part clockwise"
        disabled={editorMode !== 'part' || !selectedPartId}
        style={[styles.rotationButton, (editorMode !== 'part' || !selectedPartId) && styles.partControlDisabled]}
        onPressIn={() => beginRotation(1)}
        onPressOut={() => endRotation(1)}
      ><Text style={styles.rotationButtonText}>CW ↻</Text></TouchableOpacity>
    </View>
    <Text style={styles.partModeNotice}>
      {partModeAvailable
        ? editorMode === 'part'
          ? selectedPartId ? `PART mode · ${selectedPartId} selected` : 'PART mode · tap verified part geometry to select the whole part'
          : 'LINE mode · individual source-line editing remains active'
        : 'PART mode unavailable · controller/program identity is not verified'}
    </Text>
  </>}
  <View style={styles.legend}>
    {([
      ['#FF9F0A', 'Rapid'],
      ['#FF453A', 'Pierce'],
      ['#2F80ED', 'Lead-in'],
      ['#35D0E5', 'Cut'],
      ['#8E5CE6', 'Lead-out'],
    ] as const).map(([color, label]) => (
      <View key={label} style={styles.legendItem}>
        <View style={[styles.legendSwatch, { backgroundColor: color }]} />
        <Text style={styles.legendText}>{label}</Text>
      </View>
    ))}
  </View>
  <View style={styles.geometryLegend}>
    <Text style={styles.legendText}>━━ Straight</Text>
    <Text style={styles.legendText}>┄┄ ↻ CW arc</Text>
    <Text style={styles.legendText}>┈┈ ↺ CCW arc</Text>
  </View>
  <View style={styles.zoomRow}>
  <TouchableOpacity style={styles.zoomButton} onPress={() => setZoom(Math.max(0.5, zoom - 0.5))}>
    <Text style={styles.zoomButtonText}>Zoom -</Text>
  </TouchableOpacity>

  <View style={styles.zoomReadout}><Text style={styles.zoomReadoutText}>{zoom}x</Text></View>

  <TouchableOpacity style={styles.zoomButton} onPress={() => setZoom(zoom + 0.5)}>
    <Text style={styles.zoomButtonText}>Zoom +</Text>
  </TouchableOpacity>

  <TouchableOpacity accessibilityRole="button" style={styles.fitButton} onPress={() => { setZoom(1); setPanX(0); setPanY(0); }}>
    <Ionicons name="expand-outline" size={18} color="#fff" />
    <Text style={styles.fitButtonText}>Fit</Text>
  </TouchableOpacity>
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
  onLayout={event => setPreviewWidth(event.nativeEvent.layout.width)}
  style={styles.previewCanvas}
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
   {editorMode === 'part' && <TouchableOpacity
     accessibilityRole="button"
     accessibilityLabel="Deselect programmed part"
     activeOpacity={1}
     onPress={() => { setSelectedPartId(null); selectedPartRef.current = null; setEditError(''); }}
     style={StyleSheet.absoluteFill}
   />}
   <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: origin.y, width: previewWidth, borderTopWidth: 1, borderColor: '#555' }} />
   <View pointerEvents="none" style={{ position: 'absolute', left: origin.x, top: 0, height: 240, borderLeftWidth: 1, borderColor: '#555' }} />
   <Text pointerEvents="none" style={{ position: 'absolute', left: origin.x + 4, top: origin.y + 4, color: '#aaa', fontSize: 10 }}>0,0</Text>
   {toolpath.map((point, i) => {
  if (i === 0 || point.breakBefore) return null;

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

  const isPartSelected = editorMode === 'part' && point.programPartId === selectedPartId;
  const isSelected = editorMode === 'line' ? point.line === selectedLine : isPartSelected;
  const color = point.mode ? movementColor[point.mode] : '#35D0E5';

  return (
    <React.Fragment key={i}>
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={point.line === undefined
        ? 'Toolpath movement'
        : `Select source line ${point.line + 1}`}
      activeOpacity={0.7}
      disabled={editorMode === 'line' ? point.line === undefined : point.programPartId === undefined}
      onPress={() => selectPreviewPoint(point)}
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
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 7, width: length, borderTopColor: isSelected ? '#FFD60A' : color, borderTopWidth: isSelected ? 5 : 2, borderStyle: point.mode === 'G00' || point.geometry === 'arc-cw' ? 'dashed' : point.geometry === 'arc-ccw' ? 'dotted' : 'solid' }} />
    </TouchableOpacity>
    {point.pierce && (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Pierce at source line ${(point.line ?? 0) + 1}`}
        onPress={() => selectPreviewPoint(point)}
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
        onPress={() => selectPreviewPoint(point)}
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
  <View style={styles.coordinateRow}>
    <Text style={styles.coordinateText}>X {signed(preview.minX)} to {signed(preview.maxX)} | Y {signed(preview.minY)} to {signed(preview.maxY)}</Text>
    <Text style={styles.coordinateText}>+X right, +Y up</Text>
  </View>
</View>

<View style={styles.panel}>
  <View style={styles.sectionHeading}>
    <Ionicons name="code-slash-outline" size={24} color="#0A84FF" />
    <Text style={styles.panelTitle}>G-Code</Text>
  </View>

  <View style={styles.selectedSummary}>
    <Text style={styles.selectedTitle}>Selected line: {selectedLine === null ? 'none' : selectedLine + 1}</Text>
    <Text style={styles.inspectNotice}>
      {selectedLine === null
        ? 'Tap a line in the preview or select from code to view details.'
        : 'Selection is for inspection and does not modify code.'}
    </Text>
  </View>

  {fileName !== '' && (
    <ScrollView
      ref={codeScrollRef}
      nestedScrollEnabled
      style={styles.codeList}
      onScroll={(e) => {
        if (!scrollLocked || isSyncingScroll.current) return;
        isSyncingScroll.current = true;
        previewScrollRef.current?.scrollTo({ y: e.nativeEvent.contentOffset.y, animated: false });
        isSyncingScroll.current = false;
      }}
      scrollEventThrottle={16}
    >
      {fileContent.map((line, i) => (
        <Text
          key={i}
          onPress={() => selectSourceLine(i)}
          style={[
            styles.codeLine,
            line.includes('G') && styles.codeMotionLine,
            selectedLine === i && styles.codeLineSelected,
          ]}
        >
          {i + 1}. {line}
        </Text>
      ))}
    </ScrollView>
  )}

  {selectedLine !== null && <ScrollView
  scrollEnabled={true}
  nestedScrollEnabled={true}
  onStartShouldSetResponder={() => true}
  onMoveShouldSetResponder={() => true}
  style={{ maxHeight: 180 }}
>
    <Text style={styles.panelText}>
      {selectedLine !== null
        ? fileContent[selectedLine]
        : ''}
    </Text>
  </ScrollView>}

  {selectedLine !== null && <Text style={styles.panelText}>{coordinateDescription(fileContent, selectedLine)}</Text>}
  {measured ? <Text style={styles.panelText}>
    Start X {signed(measured.start.x)}  Y {signed(measured.start.y)}{'\n'}
    End X {signed(measured.end.x)}  Y {signed(measured.end.y)}{'\n'}
    ΔX {signed(measured.dx)}  ΔY {signed(measured.dy)}{'\n'}
    Endpoint distance {Number(measured.endpointDistance.toFixed(4))}{measured.mode === 'G02' || measured.mode === 'G03' ? ' (chord, not arc length)' : ''}
  </Text> : selectedLine !== null ? <Text style={styles.panelText}>No preview movement on this source line.</Text> : null}
  {selectedLine !== null && <View style={styles.moveNavigation}>
    <TouchableOpacity accessibilityRole="button" disabled={previousMove === undefined} onPress={() => previousMove !== undefined && selectSourceLine(previousMove)}><Text style={[styles.navigationText, previousMove === undefined && styles.disabledText]}>Previous move</Text></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" disabled={nextMove === undefined} onPress={() => nextMove !== undefined && selectSourceLine(nextMove)}><Text style={[styles.navigationText, nextMove === undefined && styles.disabledText]}>Next move</Text></TouchableOpacity>
  </View>}
</View>
{editError !== '' && <Text accessibilityRole="alert" style={{ color: '#FF9F0A' }}>{editError}</Text>}
{checkoutMessage !== '' && <Text accessibilityRole="alert" style={styles.panelText}>{checkoutMessage}</Text>}
<View style={styles.panel}>
<View style={styles.sectionHeading}>
  <Ionicons name="create-outline" size={24} color="#0A84FF" />
  <Text style={styles.panelTitle}>Edit Line Values</Text>
</View>
{measurementDraft && <Text accessibilityLabel="Draft line measurements" style={styles.panelText}>
  Draft start X {measurementDraft.start.x} Y {measurementDraft.start.y}{'\n'}
  Draft end X {measurementDraft.end.x} Y {measurementDraft.end.y}{'\n'}
  Draft ΔX {measurementDraft.dx} ΔY {measurementDraft.dy}{'\n'}
  Source after Apply: {measurementDraft.source}{'\n'}
  Uses the displayed coordinate modes and preview assumptions, not verified machine position. Following movement may start at this new endpoint.
</Text>}
{measurementDraftError !== '' && <Text accessibilityRole="alert" style={styles.panelText}>{measurementDraftError}</Text>}
  

<View style={styles.fieldGrid}>
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>X</Text>
    <TextInput style={styles.fieldInput} value={editX} accessibilityLabel="Source X" onChangeText={setEditX} />
  </View>
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>Y</Text>
    <TextInput style={styles.fieldInput} value={editY} accessibilityLabel="Source Y" onChangeText={setEditY} />
  </View>
  <View style={[styles.fieldGroup, styles.fieldGroupFull]}>
    <Text style={styles.fieldLabel}>G</Text>
    <TextInput style={styles.fieldInput} value={editG} accessibilityLabel="Source G motion" onChangeText={setEditG} />
  </View>
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>I</Text>
    <TextInput style={styles.fieldInput} value={editI} accessibilityLabel="Source I" onChangeText={setEditI} />
  </View>
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>J</Text>
    <TextInput style={styles.fieldInput} value={editJ} accessibilityLabel="Source J" onChangeText={setEditJ} />
  </View>
</View>

<View style={[styles.editActions, isCompact && styles.editActionsCompact]}>

<TouchableOpacity
  style={[styles.primaryButton, styles.editActionButton]}
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
  <Ionicons name="checkmark-outline" size={24} color="#fff" />
  <Text style={styles.primaryText}>Apply Changes</Text>
</TouchableOpacity>




<TouchableOpacity
  style={[styles.primaryButton, styles.editActionButton, styles.undoButton]}
  onPress={() => {
    if (history.length === 0) return;

    const last = history[history.length - 1];

    documentRef.current = last;
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
  <Ionicons name="arrow-undo-outline" size={22} color="#fff" />
  <Text style={styles.primaryText}>Undo</Text>
</TouchableOpacity>
</View>
</View>

<View style={styles.panel}>
<View style={styles.sectionHeading}>
  <Ionicons name="hammer-outline" size={24} color="#0A84FF" />
  <Text style={styles.panelTitle}>More Tools</Text>
</View>
<View style={[styles.toolActions, isCompact && styles.toolActionsCompact]}>
<TouchableOpacity
  style={styles.toolButton}
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
  <Ionicons name="add-outline" size={25} color="#64B5FF" />
  <Text style={styles.toolButtonText}>Add Line</Text>
</TouchableOpacity>
{insertionAfter !== null && <InsertMotionDialog document={currentDocument()} after={insertionAfter} onCancel={() => setInsertionAfter(null)} onApply={next => {
  if (isGuest || !user) { setInsertionAfter(null); return; }
  setHistory([...history, currentDocument()]);
  setFileContent(next.lines); setLineEndings(next.endings); setHasUtf8Bom(next.hasUtf8Bom);
  // Keep selection on the original line so both Apply and Undo retain the same source scope.
  setInsertionAfter(null); setEditError('');
}} />}
<TouchableOpacity
  style={styles.toolButton}
  onPress={async () => {
if (isGuest || !user || !isPro) {
  router.push('/upgrade');
  return;
}

  await Clipboard.setStringAsync(serializeTextDocument(currentDocument()));
}}
>
  <Ionicons name="copy-outline" size={22} color="#64B5FF" />
  <Text style={styles.toolButtonText}>Copy G-code</Text>
</TouchableOpacity>
<TouchableOpacity
  style={styles.toolButton}
  onPress={async () => {
    if (isGuest || !user || !isPro) { router.push('/upgrade'); return; }
    try {
      const sourceDocument = currentDocument();
      const content = serializeTextDocument(sourceDocument);
      const encoded = encodeTextDocument(sourceDocument);
      const exportBytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
      const exportName = fileName || 'edited-program.gcode';
      if (Platform.OS === 'web') {
        const blob = new Blob([exportBytes], { type: 'application/octet-stream' });
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl; link.download = exportName;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        URL.revokeObjectURL(downloadUrl);
      } else {
        const fileUri = FileSystem.documentDirectory + exportName;
        await FileSystem.writeAsStringAsync(fileUri, (hasUtf8Bom ? '\uFEFF' : '') + content);
        await Sharing.shareAsync(fileUri);
      }
    } catch (err) { console.error('Export failed:', err); alert('Export failed'); }
  }}
>
  <Ionicons name="share-outline" size={23} color="#64B5FF" />
  <Text style={styles.toolButtonText}>Export</Text>
</TouchableOpacity>
</View>
</View>
<ProgramSettings lines={fileContent} onSelect={selectSourceLine} />
  </ScrollView>
);
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050A0F',
  },
  content: {
    width: '100%', maxWidth: 980, alignSelf: 'center', padding: 24,
    paddingBottom: 180, gap: 16,
  },
  contentCompact: { padding: 14, paddingBottom: 160, gap: 14 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  headingIcon: { width: 34, alignItems: 'center' },
  headingCopy: { flex: 1, alignItems: 'center' },
  primaryActions: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  primaryActionsCompact: { gap: 10 },
  primaryActionSlot: { flex: 1 },
  importButton: { flex: 1, minHeight: 92, flexDirection: 'column', gap: 4 },
  actionHint: { color: '#EAF4FF', fontSize: 12 },
  scrollControl: {
    minHeight: 54, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: '#142536', borderColor: '#315575', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollControlActive: { backgroundColor: '#0A84FF', borderColor: '#64B5FF' },
  scrollControlText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  title: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#B8C1CC',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  primaryButton: {
    minHeight: 54,
    backgroundColor: '#087CF0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
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
    backgroundColor: '#0D1925',
    borderColor: '#284865',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  previewPanel: { paddingBottom: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  panelTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  panelText: {
    color: '#D8E0E8',
    fontSize: 15,
    lineHeight: 21,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  partControlRow: { flexDirection: 'row', alignItems: 'stretch', gap: 9 },
  rotationButton: { flex: 1, minHeight: 48, borderRadius: 10, backgroundColor: '#6D28D9', borderColor: '#A78BFA', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rotationButtonText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  modeButton: { flex: 1.25, minHeight: 48, borderRadius: 10, backgroundColor: '#087CF0', borderColor: '#64B5FF', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { backgroundColor: '#075985', borderColor: '#22D3EE', borderWidth: 2 },
  modeButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  partControlDisabled: { opacity: 0.38 },
  partModeNotice: { color: '#C4CFDA', fontSize: 13, textAlign: 'center' },
  idToggle: {
    minHeight: 44,
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
  geometryLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  zoomRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  zoomButton: { flex: 1, minHeight: 48, backgroundColor: '#087CF0', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  zoomButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  zoomReadout: { minWidth: 66, borderRadius: 10, backgroundColor: '#07111B', alignItems: 'center', justifyContent: 'center' },
  zoomReadoutText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  fitButton: { minWidth: 80, minHeight: 48, borderColor: '#168BFA', borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fitButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  previewCanvas: { height: 240, maxHeight: 240, backgroundColor: '#050B12', borderColor: '#5A748D', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  coordinateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  coordinateText: { color: '#C4CFDA', fontSize: 13 },
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
    fontSize: 14,
    lineHeight: 20,
  },
  selectedSummary: { backgroundColor: '#152A3C', borderColor: '#284865', borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  selectedTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  codeList: { maxHeight: 180, backgroundColor: '#07111B', borderRadius: 8, padding: 8 },
  codeLine: { color: '#D8E0E8', fontSize: 14, lineHeight: 24, paddingHorizontal: 6 },
  codeMotionLine: { color: '#64C8FF' },
  codeLineSelected: { backgroundColor: '#214360', borderRadius: 4 },
  moveNavigation: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  navigationText: { color: '#64B5FF', fontSize: 15, fontWeight: '600', paddingVertical: 8 },
  disabledText: { color: '#607080' },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  fieldGroup: { flexBasis: '46%', flexGrow: 1, gap: 6 },
  fieldGroupFull: { flexBasis: '100%' },
  fieldLabel: { color: '#fff', fontSize: 17, fontWeight: '700' },
  fieldInput: { minHeight: 48, color: '#fff', backgroundColor: '#162A3B', borderColor: '#42627D', borderWidth: 1, borderRadius: 9, paddingHorizontal: 13, fontSize: 16 },
  editActions: { flexDirection: 'row', gap: 12 },
  editActionsCompact: { gap: 10 },
  editActionButton: { flex: 1 },
  undoButton: { backgroundColor: '#E51F2D' },
  toolActions: { flexDirection: 'row', gap: 10 },
  toolActionsCompact: { gap: 8 },
  toolButton: { flex: 1, minHeight: 54, borderColor: '#168BFA', borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  toolButtonText: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },

});
