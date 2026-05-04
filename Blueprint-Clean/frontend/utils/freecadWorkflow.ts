export type FreeCADFeatureType =
  | 'pad'
  | 'baseWall'
  | 'flange'
  | 'hem'
  | 'pocket'
  | 'chamfer'
  | 'fillet'
  | 'mirror';
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

interface BaseResolvedShape {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  height: number;
}

interface ResolvedBox extends BaseResolvedShape {
  shape: 'box';
  width: number;
  depth: number;
}

interface ResolvedProfileExtrude extends BaseResolvedShape {
  shape: 'profileExtrude';
  outlinePoints: [number, number][];
  holes: [number, number][][];
}

type ResolvedShape = ResolvedBox | ResolvedProfileExtrude;

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
  pocket: {
    length: 70,
    width: 40,
    height: 25,
    thickness: 25,
    offsetX: 0,
    offsetZ: 0,
    rotationY: 0,
  },
  chamfer: {
    length: 10,
    width: 10,
    height: 0,
    thickness: 10,
    offsetX: 0,
    offsetZ: 0,
    rotationY: 0,
  },
  fillet: {
    length: 8,
    width: 8,
    height: 0,
    thickness: 8,
    offsetX: 0,
    offsetZ: 0,
    rotationY: 0,
  },
  mirror: {
    length: 0,
    width: 0,
    height: 0,
    thickness: 0,
    offsetX: 180,
    offsetZ: 0,
    rotationY: 0,
  },
};

const FEATURE_COLORS: Record<FreeCADFeatureType, string> = {
  pad: '#34C759',
  baseWall: '#0A84FF',
  flange: '#AF52DE',
  hem: '#FF9F0A',
  pocket: '#FF453A',
  chamfer: '#64D2FF',
  fillet: '#30D158',
  mirror: '#FFD60A',
};

const FEATURE_NAMES: Record<FreeCADFeatureType, string> = {
  pad: 'Pad',
  baseWall: 'Base Wall',
  flange: 'Flange',
  hem: 'Hem',
  pocket: 'Pocket',
  chamfer: 'Chamfer',
  fillet: 'Fillet',
  mirror: 'Mirror',
};

const FEATURE_ATTACHMENTS: Record<FreeCADFeatureType, FeatureAttachmentEdge> = {
  pad: 'front',
  baseWall: 'front',
  flange: 'end',
  hem: 'top',
  pocket: 'front',
  chamfer: 'front',
  fillet: 'front',
  mirror: 'front',
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

const rotatePoint = (point: [number, number], rotationY: number): [number, number] => {
  const angle = (rotationY * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos];
};

const translatePoint = (point: [number, number], x: number, z: number): [number, number] => [point[0] + x, point[1] + z];

const buildRectanglePoints = (width: number, depth: number): [number, number][] => [
  [-width / 2, -depth / 2],
  [width / 2, -depth / 2],
  [width / 2, depth / 2],
  [-width / 2, depth / 2],
];

const buildChamferedPoints = (width: number, depth: number, chamferSize: number): [number, number][] => {
  const inset = Math.min(chamferSize, width / 2 - 1, depth / 2 - 1);
  return [
    [-width / 2 + inset, -depth / 2],
    [width / 2 - inset, -depth / 2],
    [width / 2, -depth / 2 + inset],
    [width / 2, depth / 2 - inset],
    [width / 2 - inset, depth / 2],
    [-width / 2 + inset, depth / 2],
    [-width / 2, depth / 2 - inset],
    [-width / 2, -depth / 2 + inset],
  ];
};

const buildFilletedPoints = (width: number, depth: number, radius: number): [number, number][] => {
  const safeRadius = Math.min(radius, width / 2 - 1, depth / 2 - 1);
  const corners = [
    { cx: width / 2 - safeRadius, cz: -depth / 2 + safeRadius, start: -Math.PI / 2, end: 0 },
    { cx: width / 2 - safeRadius, cz: depth / 2 - safeRadius, start: 0, end: Math.PI / 2 },
    { cx: -width / 2 + safeRadius, cz: depth / 2 - safeRadius, start: Math.PI / 2, end: Math.PI },
    { cx: -width / 2 + safeRadius, cz: -depth / 2 + safeRadius, start: Math.PI, end: (3 * Math.PI) / 2 },
  ];

  return corners.flatMap((corner) =>
    Array.from({ length: 4 }, (_, index) => {
      const t = index / 3;
      const angle = corner.start + (corner.end - corner.start) * t;
      return [corner.cx + Math.cos(angle) * safeRadius, corner.cz + Math.sin(angle) * safeRadius] as [number, number];
    })
  );
};

const polygonArea = (points: [number, number][]) => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
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
    shape: 'box',
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
    shape: 'box',
    rotationX: 0,
    rotationY,
    rotationZ: 0,
  };
};

const buildAttachedFlangeBox = (feature: FreeCADFeature, parentBox: ResolvedShape): ResolvedBox => {
  const boxParent = parentBox.shape === 'box'
    ? parentBox
    : {
        ...parentBox,
        shape: 'box' as const,
        width: Math.max(...parentBox.outlinePoints.map((point) => point[0])) - Math.min(...parentBox.outlinePoints.map((point) => point[0])),
        depth: Math.max(...parentBox.outlinePoints.map((point) => point[1])) - Math.min(...parentBox.outlinePoints.map((point) => point[1])),
      };
  const widthAxis = getWidthAxis(boxParent.rotationY);
  const depthAxis = getDepthAxis(boxParent.rotationY);
  const childRotationY =
    feature.attachmentEdge === 'start'
      ? boxParent.rotationY + feature.bendAngle
      : feature.attachmentEdge === 'end'
        ? boxParent.rotationY - feature.bendAngle
        : boxParent.rotationY;
  const childWidthAxis = getWidthAxis(childRotationY);
  const sign = feature.attachmentEdge === 'start' ? -1 : 1;

  if (feature.attachmentEdge === 'start' || feature.attachmentEdge === 'end') {
    return {
      width: feature.params.length,
      height: feature.params.height,
      depth: feature.params.thickness,
      shape: 'box',
      x:
        boxParent.x + widthAxis.x * ((boxParent.width / 2) * sign) + childWidthAxis.x * (feature.params.length / 2),
      y: feature.params.height / 2,
      z:
        boxParent.z + widthAxis.z * ((boxParent.width / 2) * sign) + childWidthAxis.z * (feature.params.length / 2),
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
    shape: 'box',
    x: boxParent.x + depthAxis.x * ((boxParent.depth / 2) * frontSign),
    y: feature.params.height / 2,
    z: boxParent.z + depthAxis.z * ((boxParent.depth / 2) * frontSign),
    rotationX: 0,
    rotationY: boxParent.rotationY,
    rotationZ: 0,
  };
};

const buildAttachedHemBox = (feature: FreeCADFeature, parentBox: ResolvedShape): ResolvedBox => {
  const boxParent = parentBox.shape === 'box'
    ? parentBox
    : {
        ...parentBox,
        shape: 'box' as const,
        width: Math.max(...parentBox.outlinePoints.map((point) => point[0])) - Math.min(...parentBox.outlinePoints.map((point) => point[0])),
        depth: Math.max(...parentBox.outlinePoints.map((point) => point[1])) - Math.min(...parentBox.outlinePoints.map((point) => point[1])),
      };
  const depthAxis = getDepthAxis(boxParent.rotationY);
  const direction = feature.attachmentEdge === 'front' ? 1 : -1;
  const hemDepth = feature.params.height;
  const hemThickness = feature.params.thickness;

  return {
    shape: 'box',
    width: boxParent.width,
    height: hemThickness,
    depth: hemDepth,
    x: boxParent.x + depthAxis.x * ((boxParent.depth / 2) + (hemDepth / 2)) * direction,
    y: boxParent.y + (boxParent.height / 2) - (hemThickness / 2),
    z: boxParent.z + depthAxis.z * ((boxParent.depth / 2) + (hemDepth / 2)) * direction,
    rotationX: 0,
    rotationY: boxParent.rotationY,
    rotationZ: 0,
  };
};

const buildPadShapeWithOperations = (
  feature: FreeCADFeature,
  box: ResolvedBox,
  attachedFeatures: FreeCADFeature[]
): ResolvedShape => {
  const chamferFeature = attachedFeatures.find((attached) => attached.type === 'chamfer');
  const filletFeature = attachedFeatures.find((attached) => attached.type === 'fillet');
  const pocketFeatures = attachedFeatures.filter((attached) => attached.type === 'pocket');

  const outlinePoints = chamferFeature
    ? buildChamferedPoints(box.width, box.depth, chamferFeature.params.thickness || chamferFeature.params.length)
    : filletFeature
      ? buildFilletedPoints(box.width, box.depth, filletFeature.params.thickness || filletFeature.params.length)
      : buildRectanglePoints(box.width, box.depth);

  if (pocketFeatures.length === 0 && !chamferFeature && !filletFeature) {
    return box;
  }

  const holes = pocketFeatures.map((pocket) => {
    const centerX = pocket.params.offsetX;
    const centerZ = pocket.params.offsetZ;
    return buildRectanglePoints(pocket.params.length, pocket.params.width).map((point) => [point[0] + centerX, point[1] + centerZ] as [number, number]);
  });

  return {
    shape: 'profileExtrude',
    outlinePoints,
    holes,
    height: box.height,
    x: box.x,
    y: box.y,
    z: box.z,
    rotationX: 0,
    rotationY: box.rotationY,
    rotationZ: 0,
  };
};

const mirrorResolvedShape = (source: ResolvedShape, planeX: number): ResolvedShape => {
  const mirroredX = planeX + (planeX - source.x);

  if (source.shape === 'box') {
    return {
      ...source,
      x: mirroredX,
      rotationY: -source.rotationY,
    };
  }

  return {
    ...source,
    x: mirroredX,
    rotationY: -source.rotationY,
  };
};

const resolveFeatureBox = (
  feature: FreeCADFeature,
  resolvedBoxes: Record<string, ResolvedShape>
): ResolvedShape => {
  if (feature.type === 'pad') {
    return buildPadBox(feature);
  }

  if (feature.type === 'baseWall') {
    return buildStandaloneWallBox(feature);
  }

  if (feature.type === 'mirror') {
    const source = feature.attachedTo ? resolvedBoxes[feature.attachedTo] : null;
    if (!source) {
      return buildPadBox({ ...feature, type: 'pad' });
    }
    return mirrorResolvedShape(source, feature.params.offsetX);
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

const buildPadElement = (feature: FreeCADFeature, shape: ResolvedShape): CADElement => {
  const polygonPoints =
    shape.shape === 'profileExtrude'
      ? shape.outlinePoints.map((point) => translatePoint(rotatePoint(point, shape.rotationY), shape.x, shape.z))
      : buildRectanglePoints(shape.width, shape.depth).map((point) => translatePoint(rotatePoint(point, shape.rotationY), shape.x, shape.z));

  return {
    id: `feature-element-${feature.id}`,
    type: 'polygon',
    points: polygonPoints.map((point) => [canvasX(point[0]), canvasY(point[1])]),
    properties: {
      color: FEATURE_COLORS[feature.type],
      strokeWidth: 3,
      depth: shape.height,
      filled: false,
      label: feature.name,
      featureId: feature.id,
      featureType: feature.type,
      attachedTo: feature.attachedTo,
      attachmentEdge: feature.attachmentEdge,
      bendAngle: feature.bendAngle,
      threeD: {
        ...shape,
      },
    },
  };
};

const buildWallElement = (feature: FreeCADFeature, box: ResolvedShape): CADElement => {
  if (box.shape !== 'box') {
    return buildPadElement(feature, box);
  }
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
        ...box,
      },
    },
  };
};

export const buildElementsFromFeatures = (features: FreeCADFeature[]): CADElement[] => {
  const enabledFeatures = features.filter((feature) => feature.enabled);
  const featureMap = enabledFeatures.reduce<Record<string, FreeCADFeature>>((accumulator, feature) => {
    accumulator[feature.id] = feature;
    return accumulator;
  }, {});
  const attachedFeatures = enabledFeatures.reduce<Record<string, FreeCADFeature[]>>((accumulator, feature) => {
    if (!feature.attachedTo) {
      return accumulator;
    }
    accumulator[feature.attachedTo] = [...(accumulator[feature.attachedTo] || []), feature];
    return accumulator;
  }, {});

  const resolvedBoxes: Record<string, ResolvedShape> = {};

  return enabledFeatures
    .filter((feature) => !['pocket', 'chamfer', 'fillet'].includes(feature.type))
    .map((feature) => {
      const baseShape = resolveFeatureBox(feature, resolvedBoxes);
      const nextShape = feature.type === 'pad'
        ? buildPadShapeWithOperations(feature, baseShape as ResolvedBox, attachedFeatures[feature.id] || [])
        : baseShape;
      resolvedBoxes[feature.id] = nextShape;

      const mirroredSource = feature.attachedTo ? featureMap[feature.attachedTo] : null;
      const shouldRenderAsPad =
        feature.type === 'pad' ||
        nextShape.shape === 'profileExtrude' ||
        (feature.type === 'mirror' && mirroredSource?.type === 'pad');

      return shouldRenderAsPad
        ? buildPadElement(feature, nextShape)
        : buildWallElement(feature, nextShape);
    });
};

export const getFeatureFieldVisibility = (type: FreeCADFeatureType): (keyof FreeCADFeatureParams)[] => {
  switch (type) {
    case 'pocket':
      return ['length', 'width', 'height', 'offsetX', 'offsetZ'];
    case 'chamfer':
      return ['thickness'];
    case 'fillet':
      return ['thickness'];
    case 'mirror':
      return ['offsetX'];
    default:
      return ['length', 'width', 'height', 'thickness', 'offsetX', 'offsetZ', 'rotationY'];
  }
};

export const getFeatureFieldLabel = (type: FreeCADFeatureType, key: keyof FreeCADFeatureParams) => {
  if (type === 'pocket' && key === 'height') return 'Pocket Depth (mm)';
  if (type === 'chamfer' && key === 'thickness') return 'Chamfer Size (mm)';
  if (type === 'fillet' && key === 'thickness') return 'Fillet Radius (mm)';
  if (type === 'mirror' && key === 'offsetX') return 'Mirror Plane X (mm)';
  const labels: Record<keyof FreeCADFeatureParams, string> = {
    length: 'Length (mm)',
    width: 'Width (mm)',
    height: 'Height (mm)',
    thickness: 'Thickness (mm)',
    offsetX: 'Offset X (mm)',
    offsetZ: 'Offset Z (mm)',
    rotationY: 'Rotation Y (deg)',
  };
  return labels[key];
};

export const getResolvedShapeMetrics = (shape: any) => {
  if (!shape) {
    return { width: 0, depth: 0, area: 0 };
  }

  if (shape.shape === 'box') {
    return { width: shape.width, depth: shape.depth, area: shape.width * shape.depth };
  }

  const outerArea = polygonArea(shape.outlinePoints || []);
  const holeArea = (shape.holes || []).reduce((total: number, hole: [number, number][]) => total + polygonArea(hole), 0);
  const width = Math.max(...shape.outlinePoints.map((point: [number, number]) => point[0])) - Math.min(...shape.outlinePoints.map((point: [number, number]) => point[0]));
  const depth = Math.max(...shape.outlinePoints.map((point: [number, number]) => point[1])) - Math.min(...shape.outlinePoints.map((point: [number, number]) => point[1]));
  return { width, depth, area: Math.max(outerArea - holeArea, 0) };
};