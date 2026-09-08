import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

import { importControllerDocument, type InterpretedPoint } from '../utils/gcodeDocument.ts';
import {
  cancelActivePart,
  confirmActivePart,
  createNestSession,
  duplicateLastPart,
  importActivePart,
  nestWarnings,
  positionedPoints,
  rapidConnections,
  translateActivePart,
  type NestSession,
  type StartCorner,
} from '../utils/nestingSession.ts';
import { fitPreview } from '../utils/previewGeometry.ts';

const corners: { value: StartCorner; label: string }[] = [
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
];

async function pickPart(session: NestSession): Promise<NestSession | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]?.uri) return null;
  const file = result.assets[0];
  const response = await fetch(file.uri);
  return importActivePart(session, importControllerDocument(new Uint8Array(await response.arrayBuffer())), file.name || `Part ${session.nextId}`);
}

export default function NestingWorkspace() {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState('');
  const [length, setLength] = useState('');
  const [corner, setCorner] = useState<StartCorner>('bottom-left');
  const [session, setSession] = useState<NestSession | null>(null);
  const [message, setMessage] = useState('');
  const [previewWidth, setPreviewWidth] = useState(320);
  const [lastDrag, setLastDrag] = useState<{ x: number; y: number } | null>(null);

  const begin = async () => {
    try {
      const created = createNestSession(Number(width), Number(length), corner);
      const imported = await pickPart(created);
      if (imported) { setSession(imported); setMessage('Part 1 is active. Drag the drawing, then confirm placement.'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Nest setup failed.'); }
  };

  if (!open) return <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={() => setOpen(true)}><Text style={styles.primaryText}>START NEST</Text></TouchableOpacity>;

  if (!session) return <View style={styles.panel}>
    <Text style={styles.heading}>Start Nest</Text>
    <Text style={styles.copy}>Enter only the plate size and machine start corner.</Text>
    <TextInput accessibilityLabel="Plate Width X" placeholder="Plate Width — X" placeholderTextColor="#888" keyboardType="decimal-pad" value={width} onChangeText={setWidth} style={styles.input} />
    <TextInput accessibilityLabel="Plate Length Y" placeholder="Plate Length — Y" placeholderTextColor="#888" keyboardType="decimal-pad" value={length} onChangeText={setLength} style={styles.input} />
    <View style={styles.row}>{corners.map(item => <TouchableOpacity key={item.value} accessibilityRole="radio" accessibilityState={{ checked: corner === item.value }} style={[styles.choice, corner === item.value && styles.selected]} onPress={() => setCorner(item.value)}><Text style={styles.copy}>{item.label}</Text></TouchableOpacity>)}</View>
    <TouchableOpacity style={styles.primary} onPress={begin}><Text style={styles.primaryText}>IMPORT PART 1</Text></TouchableOpacity>
    <TouchableOpacity onPress={() => { setOpen(false); setMessage(''); }}><Text style={styles.link}>Cancel</Text></TouchableOpacity>
    {!!message && <Text accessibilityRole="alert" style={styles.warning}>{message}</Text>}
  </View>;

  const parts = [...session.anchored, ...(session.active ? [session.active] : [])];
  const platePoints: InterpretedPoint[] = [{ x: 0, y: 0 }, { x: session.plate.width, y: 0 }, { x: session.plate.width, y: session.plate.length }, { x: 0, y: session.plate.length }];
  const allPoints = [...platePoints, ...parts.flatMap(positionedPoints)];
  const fit = fitPreview(allPoints, previewWidth, 260);
  const plateA = fit.project({ x: 0, y: session.plate.length });
  const plateB = fit.project({ x: session.plate.width, y: 0 });
  const start = fit.project(session.plate.start);
  const warnings = nestWarnings(session);

  const moveActive = (pageX: number, pageY: number) => {
    if (!session.active || !lastDrag) return;
    setSession(translateActivePart(session, (pageX - lastDrag.x) / fit.scale, -(pageY - lastDrag.y) / fit.scale));
    setLastDrag({ x: pageX, y: pageY });
  };

  return <View style={styles.panel}>
    <Text style={styles.heading}>Nest · {session.plate.width} × {session.plate.length}</Text>
    <Text style={styles.copy}>Start: {corners.find(item => item.value === session.plate.corner)?.label}. Gray parts are anchored; cyan is the only movable part.</Text>
    <View
      accessibilityLabel="Nest placement preview"
      onLayout={event => setPreviewWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !!session.active}
      onMoveShouldSetResponder={() => !!session.active}
      onResponderGrant={event => setLastDrag({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })}
      onResponderMove={event => moveActive(event.nativeEvent.pageX, event.nativeEvent.pageY)}
      onResponderRelease={() => setLastDrag(null)}
      style={styles.preview}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: plateA.x, top: plateA.y, width: plateB.x - plateA.x, height: plateB.y - plateA.y, borderWidth: 2, borderColor: '#fff' }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: start.x - 5, top: start.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFD60A' }} />
      {parts.flatMap(part => {
        const points = positionedPoints(part);
        const active = part.id === session.active?.id;
        return points.slice(1).flatMap((point, index) => {
          if (point.breakBefore) return [];
          const from = fit.project(points[index]), to = fit.project(point);
          const dx = to.x - from.x, dy = to.y - from.y;
          return [<View key={`${part.id}-${index}`} pointerEvents="none" style={{ position: 'absolute', left: from.x, top: from.y, width: Math.hypot(dx, dy), borderTopWidth: active ? 3 : 2, borderColor: active ? '#35D0E5' : '#8E8E93', transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }], transformOrigin: 'left center' }} />];
        });
      })}
      {rapidConnections(session).map((rapid, index) => {
        const from = fit.project(rapid.from), to = fit.project(rapid.to), dx = to.x - from.x, dy = to.y - from.y;
        return <View key={`rapid-${index}`} pointerEvents="none" style={{ position: 'absolute', left: from.x, top: from.y, width: Math.hypot(dx, dy), borderTopWidth: 2, borderStyle: 'dashed', borderColor: '#FF9F0A', transform: [{ rotate: `${Math.atan2(dy, dx) * 180 / Math.PI}deg` }], transformOrigin: 'left center' }} />;
      })}
    </View>
    {warnings.map(warning => <Text key={warning} accessibilityRole="alert" style={styles.warning}>{warning}</Text>)}
    {!!message && <Text style={styles.copy}>{message}</Text>}
    {session.active ? <View style={styles.row}>
      <TouchableOpacity style={styles.primary} onPress={() => { setSession(confirmActivePart(session)); setMessage('Placement anchored. Add this part again, import a new part, or finish.'); }}><Text style={styles.primaryText}>CONFIRM PLACEMENT</Text></TouchableOpacity>
      <TouchableOpacity style={styles.choice} onPress={() => { setSession(cancelActivePart(session)); setMessage('Unconfirmed placement cancelled; anchored parts were unchanged.'); }}><Text style={styles.copy}>Cancel placement</Text></TouchableOpacity>
    </View> : <View style={styles.row}>
      <TouchableOpacity style={styles.primary} onPress={() => { try { setSession(duplicateLastPart(session)); setMessage('Duplicate is active. Drag and confirm it.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not duplicate part.'); } }}><Text style={styles.primaryText}>ADD PART</Text></TouchableOpacity>
      <TouchableOpacity style={styles.primary} onPress={async () => { try { const imported = await pickPart(session); if (imported) { setSession(imported); setMessage('New part is active. Drag and confirm it.'); } } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import part.'); } }}><Text style={styles.primaryText}>ADD NEW PART</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: true }} style={[styles.primary, styles.disabled]} onPress={() => setMessage('EXPORT / RUN is locked until a verified controller profile defines complete-program boundaries.')}><Text style={styles.primaryText}>EXPORT / RUN</Text></TouchableOpacity>
    </View>}
    <Text style={styles.warning}>Combined output is not enabled: %, M2, M30, numbering and checksum handling require a verified controller profile.</Text>
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#1b1b1b', borderColor: '#333', borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700' },
  copy: { color: '#fff', fontSize: 15 },
  warning: { color: '#FF9F0A', fontSize: 14 },
  link: { color: '#4FC3F7', textAlign: 'center', padding: 8 },
  input: { color: '#fff', borderWidth: 1, borderColor: '#666', borderRadius: 8, padding: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: '#333', borderRadius: 8, padding: 12 },
  selected: { borderWidth: 2, borderColor: '#4FC3F7' },
  primary: { backgroundColor: '#007AFF', padding: 14, borderRadius: 10, alignItems: 'center' },
  disabled: { backgroundColor: '#555' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  preview: { height: 260, backgroundColor: '#111', overflow: 'hidden' },
});
