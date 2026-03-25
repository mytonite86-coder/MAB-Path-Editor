export type FreeCADFeatureType = 'pad' | 'baseWall' | 'flange' | 'hem';
export type MeasurementUnit = 'mm' | 'in';
export type FeatureAttachmentEdge = 'start' | 'end' | 'front' | 'back' | 'top';

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
  attachedTo: string | null;
  attachmentEdge: FeatureAttachmentEdge;
  bendAngle: number;
}

interface ResolvedBox {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
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

const FEATURE_ATTACHMENTS: Record<FreeCADFeatureType, FeatureAttachmentEdge> = {
  pad: 'front',
  baseWall: 'front',
  flange: 'end',
  hem: 'top',
};

const canvasX = (value: number) => 400 + value;
const canvasY = (value: number) => 300 - value;

export const convertMmToUnit = (valueInMm: number, unit: MeasurementUnit) => {
  return unit === 'in' ? valueInMm / 25.4 : valueInMm;
};

export const convertUnitToMm = (value: number, unit: MeasurementUnit) => {
  return unit === 'in' ? value * 25.4 : value;
};

export const formatMeasurement = (valueInMm: number, unit: MeasurementUnit) => {
  const converted = convertMmToUnit(valueInMm, unit);
  const precision = unit === 'in' ? 3 : 1;
  return Number(converted.toFixed(precision)).toString();
};

const getWidthAxis = (rotationY: number) => {
  const angle = (rotationY * Math.PI) / 180;
  return { x: Math.cos(angle), z: Math.sin(angle) };
};

const getDepthAxis = (rotationY: number) => {
  const angle = (rotationY * Math.PI) / 180;
  return { x: -Math.sin(angle), z: Math.cos(angle) };
};

export const createFeature = (type: FreeCADFeatureType, index: number): FreeCADFeature => ({
  id: `feature-${type}-${Date.now()}-${index}`,
  type,
  name: `${FEATURE_NAMES[type]} ${index + 1}`,
  enabled: true,
  params: { ...FEATURE_DEFAULTS[type] },
  attachedTo: null,
  attachmentEdge: FEATURE_ATTACHMENTS[type],
  bendAngle: 90,
});

const buildPadBox = (feature: FreeCADFeature): ResolvedBox => {
  const { length, width, height, offsetX, offsetZ, rotationY } = feature.params;
  return {
    width: length,
    height,
    depth: width,
    x: offsetX,
    y: height / 2,
    z: offsetZ,
    rotationX: 0,
    rotationY,
    rotationZ: 0,
  };
};

const buildStandaloneWallBox = (feature: FreeCADFeature): ResolvedBox => {
  const { length, height, thickness, offsetX, offsetZ, rotationY } = feature.params;
  return {
    width: length,
    height,
    depth: thickness,
    x: offsetX,
    y: height / 2,
    z: offsetZ,
    rotationX: 0,
    rotationY,
    rotationZ: 0,
  };
};

const buildAttachedFlangeBox = (feature: FreeCADFeature, parentBox: ResolvedBox): ResolvedBox => {
  const widthAxis = getWidthAxis(parentBox.rotationY);
  const depthAxis = getDepthAxis(parentBox.rotationY);
  const childRotationY =
    feature.attachmentEdge === 'start'
      ? parentBox.rotationY + feature.bendAngle
      : feature.attachmentEdge === 'end'
        ? parentBox.rotationY - feature.bendAngle
        : parentBox.rotationY;
  const childWidthAxis = getWidthAxis(childRotationY);
  const sign = feature.attachmentEdge === 'start' ? -1 : 1;

  if (feature.attachmentEdge === 'start' || feature.attachmentEdge === 'end') {
    return {
      width: feature.params.length,
      height: feature.params.height,
      depth: feature.params.thickness,
      x:
        parentBox.x + widthAxis.x * ((parentBox.width / 2) * sign) + childWidthAxis.x * (feature.params.length / 2),
      y: feature.params.height / 2,
      z:
        parentBox.z + widthAxis.z * ((parentBox.width / 2) * sign) + childWidthAxis.z * (feature.params.length / 2),
      rotationX: 0,
      rotationY: childRotationY,
      rotationZ: 0,
    };
  }

  const frontSign = feature.attachmentEdge === 'front' ? 1 : -1;
  return {
    width: feature.params.length,
    height: feature.params.height,
    depth: feature.params.thickness,
    x: parentBox.x + depthAxis.x * ((parentBox.depth / 2) * frontSign),
    y: feature.params.height / 2,
    z: parentBox.z + depthAxis.z * ((parentBox.depth / 2) * frontSign),
    rotationX: 0,
    rotationY: parentBox.rotationY,
    rotationZ: 0,
  };
};

const buildAttachedHemBox = (feature: FreeCADFeature, parentBox: ResolvedBox): ResolvedBox => {
  const depthAxis = getDepthAxis(parentBox.rotationY);
  const direction = feature.attachmentEdge === 'front' ? 1 : -1;
  const hemDepth = feature.params.height;
  const hemThickness = feature.params.thickness;

  return {
    width: parentBox.width,
    height: hemThickness,
    depth: hemDepth,
    x: parentBox.x + depthAxis.x * ((parentBox.depth / 2) + (hemDepth / 2)) * direction,
    y: parentBox.y + (parentBox.height / 2) - (hemThickness / 2),
    z: parentBox.z + depthAxis.z * ((parentBox.depth / 2) + (hemDepth / 2)) * direction,
    rotationX: 0,
    rotationY: parentBox.rotationY,
    rotationZ: 0,
  };
};

const resolveFeatureBox = (
  feature: FreeCADFeature,
  resolvedBoxes: Record<string, ResolvedBox>
): ResolvedBox => {
  if (feature.type === 'pad') {
    return buildPadBox(feature);
  }

  if (feature.type === 'baseWall') {
    return buildStandaloneWallBox(feature);
  }

  const parentBox = feature.attachedTo ? resolvedBoxes[feature.attachedTo] : null;

  if (!parentBox) {
    return buildStandaloneWallBox(feature);
  }

  if (feature.type === 'flange') {
    return buildAttachedFlangeBox(feature, parentBox);
  }

  return buildAttachedHemBox(feature, parentBox);
};

const buildPadElement = (feature: FreeCADFeature, box: ResolvedBox): CADElement => {
  const halfWidth = box.width / 2;
  const halfDepth = box.depth / 2;

  return {
    id: `feature-element-${feature.id}`,
    type: 'rectangle',
    points: [
      [canvasX(box.x - halfWidth), canvasY(box.z + halfDepth)],
      [canvasX(box.x + halfWidth), canvasY(box.z - halfDepth)],
    ],
    properties: {
      color: FEATURE_COLORS[feature.type],
      strokeWidth: 3,
      depth: box.height,
      filled: false,
      label: feature.name,
      featureId: feature.id,
      featureType: feature.type,
      attachedTo: feature.attachedTo,
      attachmentEdge: feature.attachmentEdge,
      bendAngle: feature.bendAngle,
      threeD: {
        shape: 'box',
        ...box,
      },
    },
  };
};

const buildWallElement = (feature: FreeCADFeature, box: ResolvedBox): CADElement => {
  const widthAxis = getWidthAxis(box.rotationY);
  const halfWidth = box.width / 2;

  return {
    id: `feature-element-${feature.id}`,
    type: 'line',
    points: [
      [canvasX(box.x - widthAxis.x * halfWidth), canvasY(box.z - widthAxis.z * halfWidth)],
      [canvasX(box.x + widthAxis.x * halfWidth), canvasY(box.z + widthAxis.z * halfWidth)],
    ],
    properties: {
      color: FEATURE_COLORS[feature.type],
      strokeWidth: 4,
      depth: box.depth,
      draftMode: 'panel',
      label: feature.name,
      featureId: feature.id,
      featureType: feature.type,
      attachedTo: feature.attachedTo,
      attachmentEdge: feature.attachmentEdge,
      bendAngle: feature.bendAngle,
      threeD: {
        shape: 'box',
        ...box,
      },
    },
  };
};

export const buildElementsFromFeatures = (features: FreeCADFeature[]): CADElement[] => {
  const resolvedBoxes: Record<string, ResolvedBox> = {};

  return features
    .filter((feature) => feature.enabled)
    .map((feature) => {
      const box = resolveFeatureBox(feature, resolvedBoxes);
      resolvedBoxes[feature.id] = box;

      return feature.type === 'pad'
        ? buildPadElement(feature, box)
        : buildWallElement(feature, box);
    });
};