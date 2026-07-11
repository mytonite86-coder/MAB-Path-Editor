import React, { useState, useEffect, useRef } from 'react';
const codeScrollRef = useRef<ScrollView>(null);
const previewScrollRef = useRef<ScrollView>(null);
const isSyncingScroll = useRef(false);
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'expo-router';

export default function Path() {
 const { user, isGuest, isPro } = useAuth();
  const router = useRouter();
 const [selectedLine, setSelectedLine] = useState<number | null>(null);
 const [insertLineText, setInsertLineText] = useState('G1 X0 Y0');
const [fileContent, setFileContent] = useState<string[]>([]);
const [history, setHistory] = useState<string[][]>([]);
const [fileName, setFileName] = useState('');
const [fileType, setFileType] = useState('Unknown');
const [betaExpired, setBetaExpired] = useState(false);
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

const xMatch = selectedText.match(/X(-?\d+\.?\d*)/);
const yMatch = selectedText.match(/Y(-?\d+\.?\d*)/); 
const gMatch = selectedText.match(/(G\d+)/);
const iMatch = selectedText.match(/(I-?\d+\.?\d*)/);
const jMatch = selectedText.match(/(J-?\d+\.?\d*)/);
     


useEffect(() => {
  const checkBeta = async () => {
    const start = await AsyncStorage.getItem('mab_beta_start');

    if (!start) {
      await AsyncStorage.setItem('mab_beta_start', Date.now().toString());
    } else {
      const days = (Date.now() - parseInt(start)) / (1000 * 60 * 60 * 24);

      if (days > 14) {
        setBetaExpired(true);
      }
    }
  };

  checkBeta();
}, []);
  


const parsedCoords =
  selectedLine !== null
    ? fileContent.slice(0, selectedLine + 1).reduce(
        (coords, line) => {
          const xMatch = line.match(/X(-?\d+\.?\d*)/);
          const yMatch = line.match(/Y(-?\d+\.?\d*)/);

          return {
            x: xMatch ? parseFloat(xMatch[1]) : coords.x,
            y: yMatch ? parseFloat(yMatch[1]) : coords.y,
          };
        },
        { x: 0, y: 0 }
      )
    : null;

const toolpath = (() => {
 const points: { x: number; y: number; line?: number; pierce?: boolean }[] = [];
  let current = { x: 0, y: 0 };
  let command: any = null;
  let needsPierce = false;

 console.log('LINES:', fileContent.length);

  const finishCommand = () => {
    if (!command) return;

   const end = {
  x: current.x + (command.x ?? 0),
  y: current.y + (command.y ?? 0),
}; 

    if (command.mode === 'G02' || command.mode === 'G03') {
      let isPierce = false;

if (needsPierce) {
  isPierce = true;
  needsPierce = false;
}
      const cx = current.x + (command.i ?? 0);
      const cy = current.y + (command.j ?? 0);

      const startAngle = Math.atan2(current.y - cy, current.x - cx);
      const endAngle = Math.atan2(end.y - cy, end.x - cx);
      const radius = Math.sqrt((current.x - cx) ** 2 + (current.y - cy) ** 2);
      if (radius === 0 || !command.i && !command.j) {
  points.push(end)
  current = end;
  return;
}

      let sweep = endAngle - startAngle;
     if (command.mode === 'G02') {
      let isPierce = false;

if (needsPierce) {
  isPierce = true;
  needsPierce = false;
}
  if (sweep > 0) sweep -= Math.PI * 2;
} else {
  if (sweep < 0) sweep += Math.PI * 2;
}
      

      const steps = Math.max(12, Math.ceil(Math.abs(sweep) * radius * 8));

      for (let s = 1; s <= steps; s++) {
        const angle = startAngle + (sweep * s) / steps;
        points.push({
  x: cx + Math.cos(angle) * radius,
  y: cy + Math.sin(angle) * radius,
  line: command.line,
  pierce: isPierce,
});
      }

      current = end;
      return;
    }

    if (command.mode === 'G00') {
      needsPierce = true;
  current = end;
  points.push({ x: NaN, y: NaN }); // break the line
  return;
}

if (command.mode === 'G01') {
  let isPierce = false;

if (needsPierce) {
  isPierce = true;
  needsPierce = false;
}
  points.push(end)
  current = end;
}
  };

  fileContent.forEach((line, lineIndex) => {
    const gMatch = line.match(/G0?[0123]/);

    if (gMatch) {
  // Only finish if we already had a command AND movement
  if (command && (command.x !== undefined || command.y !== undefined)) {
    finishCommand();
  }

  command = {
  mode: gMatch[0].padStart(3, '0'),
  line: lineIndex
};
  return;
}

    if (!command) return;

    const xMatch = line.match(/X(-?\d+\.?\d*)/);
    const yMatch = line.match(/Y(-?\d+\.?\d*)/);
    const iMatch = line.match(/I(-?\d+\.?\d*)/);
    const jMatch = line.match(/J(-?\d+\.?\d*)/);

    if (xMatch) command.x = parseFloat(xMatch[1]);
    if (yMatch) command.y = parseFloat(yMatch[1]);
    if (iMatch) command.i = parseFloat(iMatch[1]);
    if (jMatch) command.j = parseFloat(jMatch[1]);
  });

  finishCommand();

  return points;
})();
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
  const content = await fetch(file.uri).then(r => r.text());
  
    setFileName(file.name || 'Imported file');   // 👈 ADD THIS
    
   const ext = file.name?.split('.').pop()?.toLowerCase();

if (ext === 'nc' || ext === 'tap' || ext === 'gcode') {
  setFileType('G-Code');
} else if (ext === 'dxf' || ext === 'dwg') {
  setFileType('AutoCAD');
} else {
  setFileType('Unknown');
} 
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
            onPress={() => setSelectedLine(i)}
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
  <Text style={styles.panelTitle}>Preview</Text>
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
  onStartShouldSetResponder={() => true}
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

  return (
    <View
      key={i}
      style={{
        position: 'absolute',
        left: x1 + (200 - width * scale) / 2 + panX,
        top: y1 + (200 - height * scale) / 2 + panY,
        width: length,
        
        backgroundColor: point.line === selectedLine ? 'yellow' : 'cyan',
height: point.line === selectedLine ? 4 : 2,
        transform: [{ rotate: `${angle}deg` }],
        transformOrigin: 'left center',
      }}
    />
  );
})}
      
  </ScrollView>
</View>

<View style={styles.panel}>
  <Text style={styles.panelTitle}>G-Code</Text>

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
      const content = fileContent.join('\n');
      const fileUri = FileSystem.documentDirectory + 'edited-program.cnc';

      await FileSystem.writeAsStringAsync(fileUri, content);
      await Sharing.shareAsync(fileUri);
    } catch (err) {
      console.log(err);
      alert('Export failed');
    }
  }}
>
  <Text style={styles.primaryText}>Export</Text>
</TouchableOpacity>

<TouchableOpacity
  style={styles.primaryButton}
  onPress={() => {

    if (selectedLine === null || betaExpired) return;

    setHistory(prev => [...prev, fileContent]);

    const updated = [...fileContent];

    let start = selectedLine;

    while (start > 0 && !updated[start].match(/^G0?[0123]/)) {
      start--;
    }

    for (let i = start + 1; i < updated.length; i++) {
      const line = updated[i];

      if (line.match(/^G0?[0123]/)) break;

      if (line.startsWith('X')) updated[i] = `X${editX}`;
      if (line.startsWith('Y')) updated[i] = `Y${editY}`;
      if (line.startsWith('G')) updated[i] = `G${editG}`;
      if (line.startsWith('I')) updated[i] = `I${editI}`;
      if (line.startsWith('J')) updated[i] = `J${editJ}`;
    }

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

    setFileContent(last);
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

   newLines.splice(
  insertAt,
  0,
  'G03',
  'X0',
  'Y0',
  'I0',
  'J0'
);

    setHistory([...history, fileContent]);
    setFileContent(newLines);
    setSelectedLine(insertAt);
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

  await Clipboard.setStringAsync(fileContent.join('\n'));
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

});