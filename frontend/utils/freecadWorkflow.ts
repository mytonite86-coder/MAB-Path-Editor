export type FreeCADFeatureType = 'pad' | 'baseWall' | 'flange' | 'hem';

export interface CADElement {
  type: string;
  points: number[][];
  properties: any;
  id: string;
  depth?: number;
}

export interface FreeCADFeatureParams {
  length: number;
  width: number;
  height: number;
  thickness: number;
  offsetX: number;
  offsetZ: number;
  rotationY: number;
}

export interface FreeCADFeature {
  id: string;
  type: FreeCADFeatureType;
  name: string;
  enabled: boolean;
  params: FreeCADFeatureParams;
}

const FEATURE_DEFAULTS: Record<FreeCADFeatureType, FreeCADFeatureParams> = {
  pad: {
    length: 180,
    width: 120,
    height: 25,
    thickness: 25,
    offsetX: 0,
    offsetZ: 0,
    rotationY: 0,
  },
  baseWall: {
    length: 240,
    width: 3,
    height: 180,
    thickness: 3,
    offsetX: 0,
    offsetZ: 0,
    rotationY: 0,
  },
  flange: {
    length: 120,
    width: 3,
    height: 160,
    thickness: 3,
    offsetX: 100,
    offsetZ: 50,
    rotationY: 90,
  },
  hem: {
    length: 120,
    width: 3,
    height: 18,
    thickness: 3,
    offsetX: 100,
    offsetZ: -18,
    rotationY: 90,
  },
};

const FEATURE_COLORS: Record<FreeCADFeatureType, string> = {
  pad: '#34C759',
  baseWall: '#0A84FF',
  flange: '#AF52DE',
  hem: '#FF9F0A',
};

const FEATURE_NAMES: Record<FreeCADFeatureType, string> = {
  pad: 'Pad',
  baseWall: 'Base Wall',
  flange: 'Flange',
  hem: 'Hem',
};

const canvasX = (value: number) => 400 + value;
const canvasY = (value: number) => 300 - value;

export const createFeature = (type: FreeCADFeatureType, index: number): FreeCADFeature => ({
  id: `feature-${type}-${Date.now()}-${index}`,
  type,
  name: `${FEATURE_NAMES[type]} ${index + 1}`,
  enabled: true,
  params: { ...FEATURE_DEFAULTS[type] },
});

const buildPadElement = (feature: FreeCADFeature): CADElement => {
  const { length, width, height, offsetX, offsetZ, rotationY } = feature.params;
  const halfLength = length / 2;
  const halfWidth = width / 2;

  return {
    id: `feature-element-${feature.id}`,
    type: 'rectangle',
    points: [
      [canvasX(offsetX - halfLength), canvasY(offsetZ + halfWidth)],
      [canvasX(offsetX + halfLength), canvasY(offsetZ - halfWidth)],
    ],
    properties: {
      color: FEATURE_COLORS[feature.type],
      strokeWidth: 3,
      depth: height,
      filled: false,
      label: feature.name,
      featureId: feature.id,
      featureType: feature.type,
      threeD: {
        shape: 'box',
        width: length,
        height,
        depth: width,
        x: offsetX,
        y: height / 2,
        z: offsetZ,
        rotationX: 0,
        rotationY,
        rotationZ: 0,
      },
    },
  };
};

const buildWallElement = (feature: FreeCADFeature): CADElement => {
  const { length, height, thickness, offsetX, offsetZ, rotationY } = feature.params;
  const angle = (rotationY * Math.PI) / 180;
  const dx = Math.cos(angle) * (length / 2);
  const dz = Math.sin(angle) * (length / 2);

  return {
    id: `feature-element-${feature.id}`,
    type: 'line',
    points: [
      [canvasX(offsetX - dx), canvasY(offsetZ - dz)],
      [canvasX(offsetX + dx), canvasY(offsetZ + dz)],
    ],
    properties: {
      color: FEATURE_COLORS[feature.type],
      strokeWidth: 4,
      depth: thickness,
      draftMode: 'panel',
      label: feature.name,
      featureId: feature.id,
      featureType: feature.type,
      threeD: {
        shape: 'box',
        width: length,
        height,
        depth: thickness,
        x: offsetX,
        y: height / 2,
        z: offsetZ,
        rotationX: 0,
        rotationY,
        rotationZ: 0,
      },
    },
  };
};

export const buildElementsFromFeatures = (features: FreeCADFeature[]): CADElement[] => {
  return features
    .filter((feature) => feature.enabled)
    .map((feature) => (feature.type === 'pad' ? buildPadElement(feature) : buildWallElement(feature)));
};