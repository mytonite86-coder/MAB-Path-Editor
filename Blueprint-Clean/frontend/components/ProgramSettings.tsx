import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { inspectProgramSettings } from '../utils/programSettings';

export default function ProgramSettings({ lines, onSelect }: { lines: string[]; onSelect: (line: number) => void }) {
  const [open, setOpen] = useState(false);
  const evidence = useMemo(() => open ? inspectProgramSettings(lines) : null, [lines, open]);
  const text = { color: '#D8E0E8', marginVertical: 6, fontSize: 15 };
  return <View style={{ padding: 16, backgroundColor: '#0D1925', borderColor: '#284865', borderWidth: 1, borderRadius: 14 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Ionicons name="settings-outline" size={24} color="#0A84FF" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>Program Settings</Text>
        <Text style={{ color: '#B8C1CC', fontSize: 13 }}>View programmed values and options</Text>
      </View>
      <Ionicons name={open ? 'chevron-up-outline' : 'chevron-down-outline'} size={22} color="#64B5FF" />
    </TouchableOpacity>
    {evidence && <ScrollView nestedScrollEnabled style={{ maxHeight: 360 }}>
      <Text style={text}>Source evidence only. Opening or selecting a setting never edits the program.</Text>
      <Text style={text}>Feed / program speed</Text>
      {!evidence.feed.length && <Text style={text}>No explicit feed found in supported syntax.</Text>}
      {evidence.feed.map((entry, i) => <TouchableOpacity key={`f${i}`} accessibilityRole="button" onPress={() => onSelect(entry.line - 1)}><Text style={text}>Line {entry.line}: {entry.raw} — {entry.description}</Text></TouchableOpacity>)}
      <Text style={text}>Torch amperage: {evidence.amperage}</Text>
      <Text style={text}>Tip / nozzle: {evidence.nozzle}</Text>
      <Text style={text}>Travel / rapid speed: {evidence.rapidSpeed}</Text>
      <Text style={text}>Overburn: {evidence.overburn}</Text>
      <Text style={text}>Height control: {evidence.heightControl}</Text>
      <Text style={text}>Pierce settings: {evidence.pierce}</Text>
      <Text style={text}>Process / cut chart: {evidence.references}</Text>
      <Text style={text}>Other programmed tool/process tokens — raw evidence, unsupported interpretation</Text>
      {evidence.unresolved.map((entry, i) => <TouchableOpacity key={`u${i}`} accessibilityRole="button" onPress={() => onSelect(entry.line - 1)}><Text style={text}>Line {entry.line}: {entry.raw} — {entry.description}</Text></TouchableOpacity>)}
    </ScrollView>}
  </View>;
}
