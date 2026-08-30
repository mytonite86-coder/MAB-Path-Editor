import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { inspectProgramSettings } from '../utils/programSettings';

export default function ProgramSettings({ lines, onSelect }: { lines: string[]; onSelect: (line: number) => void }) {
  const [open, setOpen] = useState(false);
  const evidence = useMemo(() => open ? inspectProgramSettings(lines) : null, [lines, open]);
  const text = { color: '#DDD', marginVertical: 6 };
  return <View style={{ padding: 16, backgroundColor: '#1A1A1A', marginVertical: 12, borderRadius: 8 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}><Text style={text}>Program Settings — read only {open ? '▾' : '▸'}</Text></TouchableOpacity>
    {evidence && <ScrollView nestedScrollEnabled style={{ maxHeight: 360 }}>
      <Text style={text}>Source evidence only. Opening or selecting a setting never edits the program.</Text>
      <Text style={text}>Feed / program speed</Text>
      {!evidence.feed.length && <Text style={text}>No explicit feed found in supported syntax.</Text>}
      {evidence.feed.map((entry, i) => <TouchableOpacity key={`f${i}`} accessibilityRole="button" onPress={() => onSelect(entry.line - 1)}><Text style={text}>Line {entry.line}: {entry.raw} — {entry.description}</Text></TouchableOpacity>)}
      <Text style={text}>Torch amperage: {evidence.amperage}</Text>
      <Text style={text}>Overburn / overcut: {evidence.overburn}</Text>
      <Text style={text}>Process / cut chart: {evidence.references}</Text>
      {evidence.unresolved.map((entry, i) => <TouchableOpacity key={`u${i}`} accessibilityRole="button" onPress={() => onSelect(entry.line - 1)}><Text style={text}>Line {entry.line}: {entry.raw} — {entry.description}</Text></TouchableOpacity>)}
    </ScrollView>}
  </View>;
}
