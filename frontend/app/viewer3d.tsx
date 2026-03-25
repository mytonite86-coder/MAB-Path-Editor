import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GLView } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';

interface CADElement {
  type: string;
  points: number[][];
  properties: any;
}

export default function Viewer3D() {
  const router = useRouter();
  const { elementsData } = useLocalSearchParams();
  const [elements, setElements] = useState<CADElement[]>([]);
  const [extrusionDepth, setExtrusionDepth] = useState('10');
  const [showEngineering, setShowEngineering] = useState(false);
  const [material, setMaterial] = useState('steel');
  const [engineeringData, setEngineeringData] = useState<any>(null);
  const sceneRunIdRef = useRef(0);

  const getFallbackDepth = (els: CADElement[], preferredDepth?: number) => {
    const depthFromElements = els.find((element) => {
      const depth = Number(element.properties?.depth);
      return Number.isFinite(depth) && depth > 0;
    })?.properties?.depth;

    const candidateDepth = Number(depthFromElements ?? preferredDepth ?? 10);
    return Number.isFinite(candidateDepth) && candidateDepth > 0 ? candidateDepth : 10;
  };

  const resolvedDepth = useMemo(
    () => getFallbackDepth(elements, Number.parseFloat(extrusionDepth)),
    [elements, extrusionDepth]
  );

  const viewerKey = useMemo(() => {
    return `${material}-${resolvedDepth}-${JSON.stringify(elements)}`;
  }, [elements, material, resolvedDepth]);

  useEffect(() => {
    if (elementsData) {
      try {
        const parsed = JSON.parse(elementsData as string);
        console.log('3D Viewer - Parsed elements:', parsed);
        console.log('3D Viewer - Element count:', parsed.length);
        setElements(parsed);
        const suggestedDepth = getFallbackDepth(parsed);
        setExtrusionDepth(String(suggestedDepth));
        calculateEngineering(parsed, suggestedDepth, 'steel');
      } catch (error) {
        console.error('Error parsing elements:', error);
        Alert.alert('Error', 'Failed to load elements for 3D view');
      }
    }
  }, [elementsData]);

  useEffect(() => {
    if (elements.length > 0) {
      calculateEngineering(elements, resolvedDepth, material);
    }
  }, [elements, material, resolvedDepth]);

  const calculateEngineering = (els: CADElement[], depth: number, mat: string) => {
    // Material properties
    const materials: any = {
      steel: { density: 7850, youngsModulus: 200, tensileStrength: 400, color: '#888888' },
      aluminum: { density: 2700, youngsModulus: 69, tensileStrength: 310, color: '#C0C0C0' },
      plastic: { density: 1200, youngsModulus: 3, tensileStrength: 50, color: '#4A90E2' },
      wood: { density: 600, youngsModulus: 11, tensileStrength: 40, color: '#8B4513' },
    };

    const matProps = materials[mat] || materials.steel;

    // Calculate total volume (simplified)
    let totalArea = 0;
    let totalVolumeMM3 = 0;
    els.forEach((el) => {
      const threeD = el.properties?.threeD;

      if (threeD?.shape === 'box') {
        totalArea += 2 * (threeD.width * threeD.height + threeD.width * threeD.depth + threeD.height * threeD.depth);
        totalVolumeMM3 += threeD.width * threeD.height * threeD.depth;
      } else if (threeD?.shape === 'panelLine' && el.points.length >= 2) {
        const x1 = el.points[0][0];
        const y1 = el.points[0][1];
        const x2 = el.points[1][0];
        const y2 = el.points[1][1];
        const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        const panelHeight = Number(threeD.height) || depth;
        const panelThickness = Number(threeD.thickness) || 3;
        totalArea += 2 * (length * panelHeight + length * panelThickness + panelHeight * panelThickness);
        totalVolumeMM3 += length * panelHeight * panelThickness;
      } else if (el.type === 'rectangle' && el.points.length >= 2) {
        const width = Math.abs(el.points[1][0] - el.points[0][0]);
        const height = Math.abs(el.points[1][1] - el.points[0][1]);
        totalArea += width * height;
        totalVolumeMM3 += width * height * depth;
      } else if (el.type === 'circle' && el.properties.radius) {
        totalArea += Math.PI * el.properties.radius * el.properties.radius;
        totalVolumeMM3 += Math.PI * el.properties.radius * el.properties.radius * depth;
      }
    });

    // Scale factor: canvas units to mm (assuming 1 canvas unit = 1mm)
    const volumeMM3 = totalVolumeMM3 || totalArea * depth;
    const volumeM3 = volumeMM3 / 1000000000; // Convert mm³ to m³

    // Calculate mass
    const massKg = volumeM3 * matProps.density;

    // Calculate surface area
    const surfaceArea = totalArea * 2 + (Math.sqrt(totalArea) * 4 * depth);

    // Basic structural metrics
    const centerOfMass = {
      x: 400, // Simplified - center of canvas
      y: 300,
      z: depth / 2,
    };

    setEngineeringData({
      volume: {
        mm3: volumeMM3.toFixed(2),
        cm3: (volumeMM3 / 1000).toFixed(2),
        m3: volumeM3.toExponential(2),
      },
      surfaceArea: {
        mm2: surfaceArea.toFixed(2),
        cm2: (surfaceArea / 100).toFixed(2),
      },
      mass: {
        kg: massKg.toFixed(3),
        g: (massKg * 1000).toFixed(1),
      },
      material: {
        name: mat.charAt(0).toUpperCase() + mat.slice(1),
        density: matProps.density,
        youngsModulus: matProps.youngsModulus,
        tensileStrength: matProps.tensileStrength,
      },
      centerOfMass,
      elementCount: els.length,
    });
  };

  const handleRecalculate = () => {
    const depth = resolvedDepth;
    calculateEngineering(elements, depth, material);
  };

  const onContextCreate = async (gl: any) => {
    sceneRunIdRef.current += 1;
    const currentSceneRunId = sceneRunIdRef.current;
    const { drawingBufferWidth: width, drawingBufferHeight: height } = gl;

    // Get depth early
    const depth = resolvedDepth;

    // Create renderer
    const renderer: any = new Renderer({ gl });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000);

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    // Create camera
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 2000);
    camera.position.set(0, 250, 400);
    camera.lookAt(0, 0, 0);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(100, 100, 100);
    scene.add(directionalLight);

    // Add grid
    const gridHelper = new THREE.GridHelper(800, 24, 0x444444, 0x222222);
    gridHelper.position.y = -depth / 2 - 20;
    scene.add(gridHelper);

    // Add axis helper
    const axesHelper = new THREE.AxesHelper(200);
    scene.add(axesHelper);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    // Get material properties
    const materials: any = {
      steel: 0x888888,
      aluminum: 0xc0c0c0,
      plastic: 0x4a90e2,
      wood: 0x8b4513,
    };
    const matColor = materials[material] || materials.steel;

    // Create 3D objects from 2D elements
    const meshMaterial = new THREE.MeshPhongMaterial({
      color: matColor,
      side: THREE.DoubleSide,
      shininess: 30,
    });

    console.log('3D Viewer - Creating 3D models for', elements.length, 'elements');

    elements.forEach((element, index) => {
      console.log(`3D Viewer - Processing element ${index}:`, element.type, element.points);
      try {
        const solid3D = element.properties?.threeD;

        if (solid3D?.shape === 'box') {
          const geometry = new THREE.BoxGeometry(solid3D.width, solid3D.height, solid3D.depth);
          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.set(solid3D.x || 0, solid3D.y || 0, solid3D.z || 0);
          mesh.rotation.set(
            ((solid3D.rotationX || 0) * Math.PI) / 180,
            ((solid3D.rotationY || 0) * Math.PI) / 180,
            ((solid3D.rotationZ || 0) * Math.PI) / 180
          );
          modelGroup.add(mesh);

          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
          );
          line.position.copy(mesh.position);
          line.rotation.copy(mesh.rotation);
          modelGroup.add(line);
          return;
        }

        if (solid3D?.shape === 'panelLine' && element.type === 'line' && element.points.length >= 2) {
          const x1 = element.points[0][0] - 400;
          const z1 = -(element.points[0][1] - 300);
          const x2 = element.points[1][0] - 400;
          const z2 = -(element.points[1][1] - 300);
          const panelHeight = Number(solid3D.height) || depth;
          const panelThickness = Number(solid3D.thickness) || 3;
          const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
          const angle = Math.atan2(z2 - z1, x2 - x1);

          const geometry = new THREE.BoxGeometry(length, panelHeight, panelThickness);
          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.set((x1 + x2) / 2, panelHeight / 2, (z1 + z2) / 2);
          mesh.rotation.y = -angle;
          modelGroup.add(mesh);

          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
          );
          line.position.copy(mesh.position);
          line.rotation.copy(mesh.rotation);
          modelGroup.add(line);
          return;
        }

        // Get depth from element properties, fallback to global depth setting
        const elementDepth = element.properties?.depth || depth;
        
        if (element.type === 'rectangle' && element.points.length >= 2) {
          const width = Math.abs(element.points[1][0] - element.points[0][0]);
          const height = Math.abs(element.points[1][1] - element.points[0][1]);
          const centerX = (element.points[0][0] + element.points[1][0]) / 2 - 400;
          const centerZ = -((element.points[0][1] + element.points[1][1]) / 2 - 300);

          const geometry = new THREE.BoxGeometry(width, elementDepth, height);
          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.set(centerX, 0, centerZ);
          modelGroup.add(mesh);

          // Add edges
          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
          );
          line.position.set(centerX, 0, centerZ);
          modelGroup.add(line);
        } else if (element.type === 'circle' && element.properties.radius) {
          const radius = element.properties.radius;
          const centerX = element.points[0][0] - 400;
          const centerZ = -(element.points[0][1] - 300);

          const geometry = new THREE.CylinderGeometry(radius, radius, elementDepth, 32);
          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.set(centerX, 0, centerZ);
          mesh.rotation.x = Math.PI / 2;
          modelGroup.add(mesh);

          // Add edges
          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
          );
          line.position.set(centerX, 0, centerZ);
          line.rotation.x = Math.PI / 2;
          modelGroup.add(line);
        } else if (element.type === 'line' && element.points.length >= 2) {
          // Create a thin box for lines
          const x1 = element.points[0][0] - 400;
          const z1 = -(element.points[0][1] - 300);
          const x2 = element.points[1][0] - 400;
          const z2 = -(element.points[1][1] - 300);

          const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
          const angle = Math.atan2(z2 - z1, x2 - x1);

          const geometry = new THREE.BoxGeometry(length, elementDepth, 3);
          const mesh = new THREE.Mesh(geometry, meshMaterial);
          mesh.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
          mesh.rotation.y = -angle;
          modelGroup.add(mesh);

          // Add edge highlight
          const edges = new THREE.EdgesGeometry(geometry);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0xffffff })
          );
          line.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
          line.rotation.y = -angle;
          modelGroup.add(line);
        }
      } catch (error) {
        console.error('Error creating 3D element:', error);
      }
    });

    const boundingBox = new THREE.Box3().setFromObject(modelGroup);
    if (!boundingBox.isEmpty()) {
      const size = boundingBox.getSize(new THREE.Vector3());
      const center = boundingBox.getCenter(new THREE.Vector3());
      const boundingSphere = boundingBox.getBoundingSphere(new THREE.Sphere());
      const fovInRadians = (camera.fov * Math.PI) / 180;
      const fitHeightDistance = boundingSphere.radius / Math.sin(fovInRadians / 2);
      const fitWidthDistance = fitHeightDistance / Math.max(camera.aspect, 1);
      const fitDistance = Math.max(fitHeightDistance, fitWidthDistance, 120);

      camera.position.set(
        center.x + fitDistance * 0.7,
        center.y + fitDistance * 0.45,
        center.z + fitDistance * 0.7
      );
      camera.near = Math.max(0.1, fitDistance / 500);
      camera.far = fitDistance * 30;
      camera.updateProjectionMatrix();
      camera.lookAt(center);

      directionalLight.position.set(
        center.x + fitDistance,
        center.y + fitDistance,
        center.z + fitDistance
      );

      gridHelper.position.set(center.x, boundingBox.min.y - 20, center.z);
      axesHelper.position.copy(center);
    }

    // Animation loop
    let rotationY = 0;
    const render = () => {
      if (sceneRunIdRef.current !== currentSceneRunId) {
        return;
      }

      requestAnimationFrame(render);

      // Rotate scene around Y axis (vertical rotation)
      rotationY += 0.01;
      scene.rotation.y = rotationY;

      renderer.render(scene, camera);
      gl.endFrameEXP();
    };
    render();
  };

  useEffect(() => {
    return () => {
      sceneRunIdRef.current += 1;
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header} testID="viewer3d-header">
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          testID="viewer3d-back-button"
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title} testID="viewer3d-title">3D Viewer</Text>
        <TouchableOpacity
          onPress={() => setShowEngineering(!showEngineering)}
          style={styles.engineeringButton}
          testID="viewer3d-engineering-toggle-button"
        >
          <Ionicons name="analytics" size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      <GLView
        key={viewerKey}
        style={styles.glView}
        onContextCreate={onContextCreate}
        testID="viewer3d-gl-view"
      />

      <View style={styles.controls}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.controlRow}>
            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Depth (mm)</Text>
              <TextInput
                style={styles.controlInput}
                value={extrusionDepth}
                onChangeText={setExtrusionDepth}
                keyboardType="numeric"
                placeholder="10"
                placeholderTextColor="#666"
                testID="viewer3d-depth-input"
              />
            </View>

            <View style={styles.controlGroup}>
              <Text style={styles.controlLabel}>Material</Text>
              <ScrollView horizontal style={styles.materialScroll}>
                {['steel', 'aluminum', 'plastic', 'wood'].map((mat) => (
                  <TouchableOpacity
                    key={mat}
                    style={[
                      styles.materialButton,
                      material === mat && styles.materialButtonActive,
                    ]}
                    onPress={() => setMaterial(mat)}
                    testID={`viewer3d-material-${mat}`}
                  >
                    <Text
                      style={[
                        styles.materialText,
                        material === mat && styles.materialTextActive,
                      ]}
                    >
                      {mat.charAt(0).toUpperCase() + mat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={styles.recalcButton}
              onPress={handleRecalculate}
              testID="viewer3d-update-button"
            >
              <Ionicons name="refresh" size={20} color="#fff" />
              <Text style={styles.recalcText}>Update</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      <Modal visible={showEngineering} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent} testID="viewer3d-engineering-modal">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Engineering Analysis</Text>
              <TouchableOpacity onPress={() => setShowEngineering(false)} testID="viewer3d-engineering-close-button">
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>

            {engineeringData && (
              <ScrollView style={styles.modalBody}>
                <View style={styles.dataSection}>
                  <Text style={styles.sectionTitle}>Volume</Text>
                  <Text style={styles.dataText}>
                    {engineeringData.volume.mm3} mm³
                  </Text>
                  <Text style={styles.dataText}>
                    {engineeringData.volume.cm3} cm³
                  </Text>
                  <Text style={styles.dataText}>
                    {engineeringData.volume.m3} m³
                  </Text>
                </View>

                <View style={styles.dataSection}>
                  <Text style={styles.sectionTitle}>Surface Area</Text>
                  <Text style={styles.dataText}>
                    {engineeringData.surfaceArea.mm2} mm²
                  </Text>
                  <Text style={styles.dataText}>
                    {engineeringData.surfaceArea.cm2} cm²
                  </Text>
                </View>

                <View style={styles.dataSection}>
                  <Text style={styles.sectionTitle}>Mass</Text>
                  <Text style={styles.dataText}>{engineeringData.mass.kg} kg</Text>
                  <Text style={styles.dataText}>{engineeringData.mass.g} g</Text>
                </View>

                <View style={styles.dataSection}>
                  <Text style={styles.sectionTitle}>Material Properties</Text>
                  <Text style={styles.dataText}>
                    Material: {engineeringData.material.name}
                  </Text>
                  <Text style={styles.dataText}>
                    Density: {engineeringData.material.density} kg/m³
                  </Text>
                  <Text style={styles.dataText}>
                    Young's Modulus: {engineeringData.material.youngsModulus} GPa
                  </Text>
                  <Text style={styles.dataText}>
                    Tensile Strength: {engineeringData.material.tensileStrength} MPa
                  </Text>
                </View>

                <View style={styles.dataSection}>
                  <Text style={styles.sectionTitle}>Geometry</Text>
                  <Text style={styles.dataText}>
                    Elements: {engineeringData.elementCount}
                  </Text>
                  <Text style={styles.dataText}>
                    Center of Mass: ({engineeringData.centerOfMass.x.toFixed(1)},{' '}
                    {engineeringData.centerOfMass.y.toFixed(1)},{' '}
                    {engineeringData.centerOfMass.z.toFixed(1)})
                  </Text>
                </View>

                <View style={styles.exportSection}>
                  <Text style={styles.sectionTitle}>Export Options</Text>
                  <TouchableOpacity
                    style={styles.exportButton}
                    onPress={() => Alert.alert('Coming Soon', 'STL export coming soon!')}
                  >
                    <Ionicons name="cube" size={20} color="#fff" />
                    <Text style={styles.exportText}>Export as STL (3D Printing)</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.exportButton}
                    onPress={() => Alert.alert('Coming Soon', 'OBJ export coming soon!')}
                  >
                    <Ionicons name="document" size={20} color="#fff" />
                    <Text style={styles.exportText}>Export as OBJ</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      <View style={styles.info}>
        <Ionicons name="information-circle" size={16} color="#666" />
        <Text style={styles.infoText} testID="viewer3d-info-text">Rotating automatically. Pinch to zoom.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
    textAlign: 'center',
  },
  engineeringButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glView: {
    flex: 1,
  },
  controls: {
    backgroundColor: '#1a1a1a',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  controlGroup: {
    marginRight: 16,
  },
  controlLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  controlInput: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 8,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#333',
    minWidth: 80,
  },
  materialScroll: {
    flexDirection: 'row',
  },
  materialButton: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  materialButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  materialText: {
    color: '#fff',
    fontSize: 12,
  },
  materialTextActive: {
    fontWeight: '600',
  },
  recalcButton: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recalcText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#0a0a0a',
  },
  infoText: {
    color: '#666',
    fontSize: 12,
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalBody: {
    flex: 1,
  },
  dataSection: {
    marginBottom: 24,
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 12,
  },
  dataText: {
    fontSize: 14,
    color: '#fff',
    marginBottom: 6,
  },
  exportSection: {
    marginTop: 16,
  },
  exportButton: {
    backgroundColor: '#34C759',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  exportText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
});
