import React, { useState } from 'react';
import { Modal, ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { inspectInsertion, planInsertion } from '../utils/insertionPlan';
import { interpretToolpath, type TextDocument } from '../utils/gcodeDocument';
import { fitPreview } from '../utils/previewGeometry';
import type { InsertionKind } from '../utils/motionInsertion';

const choices: [InsertionKind, string][] = [['line', 'Straight line'], ['arc-cw', 'Curve / arc clockwise'], ['arc-ccw', 'Curve / arc counterclockwise'], ['rapid', 'Rapid movement'], ['pierce', 'Pierce — planned / unsupported'], ['lead-in', 'Lead-in'], ['lead-out', 'Lead-out']];
const message = (error: unknown) => error instanceof Error ? error.message : 'Insertion could not be validated.';

export default function InsertMotionDialog({ document, after, onCancel, onApply }: {
  document: TextDocument; after: number; onCancel: () => void; onApply: (next: TextDocument) => void;
}) {
  const [kind, setKind] = useState<InsertionKind>('line');
  const [fields, setFields] = useState({ endX: '', endY: '', centerX: '', centerY: '' });
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ plan: ReturnType<typeof planInsertion>; source: TextDocument } | null>(null);
  let inspection: ReturnType<typeof inspectInsertion> | undefined;
  let gate = '';
  try { inspection = inspectInsertion(document, after); } catch (e) { gate = message(e); }
  const arc = kind === 'arc-cw' || kind === 'arc-ccw';
  const lead = kind === 'lead-in' || kind === 'lead-out' || kind === 'pierce';
  const numberField = (key: keyof typeof fields) => {
    const value = fields[key].trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`${key} requires a finite signed decimal.`);
    return Number(value);
  };
  const candidate = () => planInsertion(document, after, kind, {
    endX: numberField('endX'), endY: numberField('endY'),
    ...(arc ? { centerX: numberField('centerX'), centerY: numberField('centerY') } : {}),
  });
  const currentReview = review && review.source.lines === document.lines && review.source.endings === document.endings;
  const points = review ? interpretToolpath([
    'G90', `G00 X${review.plan.context.start.x} Y${review.plan.context.start.y}`,
    review.plan.context.distance === 'absolute' ? 'G90' : 'G91',
    review.plan.context.arcCenter === 'absolute' ? 'G90.1' : 'G91.1', review.plan.generated,
  ]).slice(1) : [];
  const rejoin = review?.plan.rejoin;
  const fit = fitPreview([...points, ...(rejoin ? [rejoin] : [])], 280, 180, 1, 0, 0);
  const labels = { endX: 'Endpoint X', endY: 'Endpoint Y', centerX: 'Arc center X', centerY: 'Arc center Y' };
  return <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
    <View style={s.overlay}><ScrollView style={s.card} contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={s.title}>Add movement</Text>
      <Text style={s.text}>Insert after source line {after + 1}. Cancel leaves the program unchanged.</Text>
      {inspection && <Text style={s.text}>Start X {inspection.context.start.x}, Y {inspection.context.start.y}; {inspection.context.units}; {inspection.context.distance} endpoints; {inspection.context.arcCenter} arc centers; XY plane; G54 work coordinates; feed {inspection.feed} {inspection.context.units}/min; M5 declared.</Text>}
      {gate !== '' && <Text accessibilityRole="alert" style={s.warning}>{gate}</Text>}
      {choices.map(([value, label]) => <TouchableOpacity key={value} accessibilityRole="radio" accessibilityState={{ checked: kind === value }} style={s.button} onPress={() => { setKind(value); setReview(null); setError(''); }}><Text style={s.text}>{kind === value ? '● ' : '○ '}{label}</Text></TouchableOpacity>)}
      {lead ? <Text accessibilityRole="alert" style={s.warning}>Unsupported until a verified controller profile is available.</Text> : <>
        <Text style={s.text}>Enter endpoint{arc ? ' and center' : ''} as absolute coordinates in the displayed work frame. The generated words use the program’s declared modes. Feed is inherited; process remains off.</Text>
        {(['endX', 'endY', ...(arc ? ['centerX', 'centerY'] : [])] as (keyof typeof fields)[]).map(key => <View key={key}>
          <Text style={s.text}>{labels[key]}</Text><TextInput accessibilityLabel={`Insert ${key}`} style={s.input} value={fields[key]} onChangeText={value => { setFields({ ...fields, [key]: value }); setReview(null); setError(''); }} />
        </View>)}
        <TouchableOpacity accessibilityRole="button" disabled={!!gate} style={s.button} onPress={() => { try { setReview({ plan: candidate(), source: document }); setError(''); } catch (e) { setReview(null); setError(message(e)); } }}><Text style={s.text}>Preview insertion</Text></TouchableOpacity>
      </>}
      {error !== '' && <Text accessibilityRole="alert" style={s.warning}>{error}</Text>}
      {currentReview && review && <>
        <Text style={s.text}>{review.plan.generated}</Text>
        <Text style={s.text}>Start X {review.plan.context.start.x} Y {review.plan.context.start.y}; end X {fields.endX} Y {fields.endY}. Start is the selected boundary; edit the preceding endpoint to change it.</Text>
        <Text style={s.text}>Blue: candidate. Dot: start. Orange dashed: changed connecting rapid. +X right, +Y up.</Text>
        <Svg width={280} height={180} accessibilityLabel="Candidate movement preview">
          <Polyline points={points.map(point => { const p = fit.project(point); return `${p.x},${p.y}`; }).join(' ')} stroke="#35D0E5" strokeWidth={2} fill="none" />
          {points.length > 0 && <Circle cx={fit.project(points[0]).x} cy={fit.project(points[0]).y} r={4} fill="#FFF" />}
          {rejoin && points.length > 0 && <Line x1={fit.project(points[points.length - 1]).x} y1={fit.project(points[points.length - 1]).y} x2={fit.project(rejoin).x} y2={fit.project(rejoin).y} stroke="#FF9F0A" strokeWidth={2} strokeDasharray="5 4" />}
        </Svg>
        <Text style={s.warning}>{review.plan.downstream} Preview is not controller or machine clearance verification.</Text>
        <TouchableOpacity accessibilityRole="button" style={s.button} onPress={() => { try { const next = candidate(); onApply(next.document); } catch (e) { setError(message(e)); setReview(null); } }}><Text style={s.text}>Apply reviewed insertion</Text></TouchableOpacity>
      </>}
      <TouchableOpacity accessibilityRole="button" style={s.button} onPress={onCancel}><Text style={s.text}>Cancel</Text></TouchableOpacity>
    </ScrollView></View>
  </Modal>;
}
const s = StyleSheet.create({ overlay: { flex: 1, backgroundColor: '#000B', justifyContent: 'center', alignItems: 'center', padding: 12 }, card: { width: '100%', maxWidth: 600, maxHeight: '90%', backgroundColor: '#171717', borderRadius: 12 }, text: { color: '#eee', marginVertical: 5 }, title: { color: '#fff', fontSize: 22, fontWeight: 'bold' }, warning: { color: '#FFD080', marginVertical: 8 }, button: { padding: 12, backgroundColor: '#303030', borderRadius: 6, marginVertical: 4 }, input: { color: '#fff', borderWidth: 1, borderColor: '#888', borderRadius: 4, padding: 10 } });
