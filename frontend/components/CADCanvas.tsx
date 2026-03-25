import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Dimensions, Text } from 'react-native';
import Svg, { Line, Rect, Circle, Polygon, Text as SvgText, G } from 'react-native-svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_WIDTH = SCREEN_WIDTH - 32;
const CANVAS_HEIGHT = 500;

interface CADElement {
  type: string;
  points: number[][];
  properties: any;
  id: string;
}

interface CADCanvasProps {
  elements: CADElement[];
  onElementsChange?: (elements: CADElement[]) => void;
  activeTool?: string;
  activeColor?: string;
  activeStrokeWidth?: number;
  activeDepth?: number;
  panelHeight?: number;
  sheetThickness?: number;
  backgroundColor?: 'dark' | 'light';
  selectedElementId?: string | null;
  onElementSelect?: (id: string | null) => void;
  viewportResetSignal?: number;
}

export default function CADCanvas({
  elements,
  onElementsChange,
  activeTool = 'select',
  activeColor = '#000000',
  activeStrokeWidth = 2,
  activeDepth = 10,
  panelHeight = 203.2,
  sheetThickness = 3,
  backgroundColor = 'dark',
  selectedElementId = null,
  onElementSelect,
  viewportResetSignal = 0,
}: CADCanvasProps) {
  const [currentPoints, setCurrentPoints] = useState<number[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [dragPoint, setDragPoint] = useState<{x: number, y: number} | null>(null);
  const [panPoint, setPanPoint] = useState<{x: number, y: number} | null>(null);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setViewportOffset({ x: 0, y: 0 });
  }, [viewportResetSignal]);

  const getVisibleColor = (rawColor: string) => {
    const normalizedColor = rawColor.toLowerCase();

    if (backgroundColor === 'dark' && (normalizedColor === '#000000' || normalizedColor === '#000')) {
      return '#F5F5F5';
    }

    if (backgroundColor === 'light' && (normalizedColor === '#ffffff' || normalizedColor === '#fff')) {
      return '#111111';
    }

    return rawColor;
  };

  const isPointInElement = (x: number, y: number, element: CADElement): boolean => {
    const { type, points, properties } = element;
    const lineHitTolerance = properties?.draftMode === 'panel' ? 20 : 16;
    
    if (type === 'rectangle' && points.length >= 2) {
      const minX = Math.min(points[0][0], points[1][0]);
      const maxX = Math.max(points[0][0], points[1][0]);
      const minY = Math.min(points[0][1], points[1][1]);
      const maxY = Math.max(points[0][1], points[1][1]);
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }
    
    if (type === 'circle' && points.length >= 1 && properties.radius) {
      const dx = x - points[0][0];
      const dy = y - points[0][1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      return distance <= properties.radius;
    }
    
    if (type === 'line' && points.length >= 2) {
      // Check if point is near the line
      const dx = points[1][0] - points[0][0];
      const dy = points[1][1] - points[0][1];
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length === 0) return false;
      const dot = ((x - points[0][0]) * dx + (y - points[0][1]) * dy) / (length * length);
      
      if (dot < 0 || dot > 1) return false;
      
      const projX = points[0][0] + dot * dx;
      const projY = points[0][1] + dot * dy;
      const distance = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
      return distance <= lineHitTolerance;
    }
    
    return false;
  };

  const toCanvasPoint = (x: number, y: number) => ({
    x: x - viewportOffset.x,
    y: y - viewportOffset.y,
  });

  const handleTouchStart = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;

    if (activeTool === 'pan') {
      setPanPoint({ x: locationX, y: locationY });
      return;
    }

    const canvasPoint = toCanvasPoint(locationX, locationY);
    
    if (activeTool === 'select') {
      // Check if touching an existing element
      for (let i = elements.length - 1; i >= 0; i--) {
        if (isPointInElement(canvasPoint.x, canvasPoint.y, elements[i])) {
          if (onElementSelect) {
            onElementSelect(elements[i].id || null);
          }
          setDragPoint({ x: canvasPoint.x, y: canvasPoint.y });
          return;
        }
      }
      // Clicked empty area - deselect
      if (onElementSelect) {
        onElementSelect(null);
      }
      return;
    }
    
    setIsDrawing(true);
    setCurrentPoints([[canvasPoint.x, canvasPoint.y]]);
  };

  const handleTouchMove = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;

    if (activeTool === 'pan' && panPoint) {
      const dx = locationX - panPoint.x;
      const dy = locationY - panPoint.y;
      setViewportOffset((currentOffset) => ({
        x: currentOffset.x + dx,
        y: currentOffset.y + dy,
      }));
      setPanPoint({ x: locationX, y: locationY });
      return;
    }

    const canvasPoint = toCanvasPoint(locationX, locationY);
    
    if (activeTool === 'select' && selectedElementId && dragPoint) {
      // Move selected element
      const dx = canvasPoint.x - dragPoint.x;
      const dy = canvasPoint.y - dragPoint.y;
      
      const updatedElements = elements.map(el => {
        if (el.id === selectedElementId) {
          return {
            ...el,
            points: el.points.map(point => [point[0] + dx, point[1] + dy])
          };
        }
        return el;
      });
      
      if (onElementsChange) {
        onElementsChange(updatedElements);
      }
      
      setDragPoint({ x: canvasPoint.x, y: canvasPoint.y });
      return;
    }
    
    if (!isDrawing || activeTool === 'select' || activeTool === 'pan') return;
    
    if (activeTool === 'line' || activeTool === 'panel' || activeTool === 'rectangle' || activeTool === 'circle') {
      setCurrentPoints([[currentPoints[0][0], currentPoints[0][1]], [canvasPoint.x, canvasPoint.y]]);
    }
  };

  const handleTouchEnd = () => {
    if (activeTool === 'pan') {
      setPanPoint(null);
      return;
    }

    if (activeTool === 'select') {
      setDragPoint(null);
      return;
    }
    
    if (!isDrawing) return;
    
    if (currentPoints.length >= 1) {
      const points = currentPoints.length >= 2 
        ? currentPoints 
        : [[currentPoints[0][0], currentPoints[0][1]], [currentPoints[0][0] + 50, currentPoints[0][1] + 50]];

      const isPanelDraft = activeTool === 'panel';
      
      const newElement: CADElement = {
        id: `elem_${Date.now()}`,
        type: isPanelDraft ? 'line' : activeTool,
        points: points,
        properties: {
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          layer: 'default',
          depth: isPanelDraft ? sheetThickness : activeDepth,
          ...(isPanelDraft
            ? {
                draftMode: 'panel',
                filled: true,
                threeD: {
                  shape: 'panelLine',
                  height: panelHeight,
                  thickness: sheetThickness,
                },
              }
            : {}),
        },
      };

      if (activeTool === 'circle' && points.length >= 2) {
        const [x1, y1] = points[0];
        const [x2, y2] = points[1];
        const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
        newElement.properties.radius = radius;
        newElement.points = [[x1, y1]];
      }

      if (onElementsChange) {
        onElementsChange([...elements, newElement]);
      }
    }

    setIsDrawing(false);
    setCurrentPoints([]);
  };

  const renderElement = (element: CADElement, index: number) => {
    const { type, points, properties } = element;
    const color = getVisibleColor(properties.color || '#000000');
    const strokeWidth = properties.strokeWidth || 2;
    const key = element.id || `element_${index}`;
    const isSelected = element.id === selectedElementId;
    const selectionColor = '#00FF00';
    const visualStrokeWidth = properties.draftMode === 'panel' ? Math.max(strokeWidth + 2, 4) : strokeWidth;

    switch (type) {
      case 'line':
        if (points.length >= 2) {
          return (
            <G key={key}>
              <Line
                x1={points[0][0]}
                y1={points[0][1]}
                x2={points[1][0]}
                y2={points[1][1]}
                stroke={color}
                strokeWidth={visualStrokeWidth}
              />
              {isSelected && (
                <Line
                  x1={points[0][0]}
                  y1={points[0][1]}
                  x2={points[1][0]}
                  y2={points[1][1]}
                  stroke={selectionColor}
                  strokeWidth={visualStrokeWidth + 6}
                  opacity={0.5}
                />
              )}
            </G>
          );
        }
        break;

      case 'rectangle':
        if (points.length >= 2) {
          const x = Math.min(points[0][0], points[1][0]);
          const y = Math.min(points[0][1], points[1][1]);
          const width = Math.abs(points[1][0] - points[0][0]);
          const height = Math.abs(points[1][1] - points[0][1]);
          return (
            <G key={key}>
              <Rect
                x={x}
                y={y}
                width={width}
                height={height}
                stroke={color}
                strokeWidth={strokeWidth}
                fill={properties.filled ? color : 'none'}
                fillOpacity={properties.filled ? 0.2 : 0}
              />
              {isSelected && (
                <Rect
                  x={x - 2}
                  y={y - 2}
                  width={width + 4}
                  height={height + 4}
                  stroke={selectionColor}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray="5,5"
                />
              )}
            </G>
          );
        }
        break;

      case 'circle':
        if (points.length >= 1 && properties.radius) {
          return (
            <G key={key}>
              <Circle
                cx={points[0][0]}
                cy={points[0][1]}
                r={properties.radius}
                stroke={color}
                strokeWidth={strokeWidth}
                fill={properties.filled ? color : 'none'}
                fillOpacity={properties.filled ? 0.2 : 0}
              />
              {isSelected && (
                <Circle
                  cx={points[0][0]}
                  cy={points[0][1]}
                  r={properties.radius + 3}
                  stroke={selectionColor}
                  strokeWidth={2}
                  fill="none"
                  strokeDasharray="5,5"
                />
              )}
            </G>
          );
        }
        break;

      case 'polygon':
        if (points.length >= 3) {
          const pointsString = points.map((p) => `${p[0]},${p[1]}`).join(' ');
          return (
            <Polygon
              key={key}
              points={pointsString}
              stroke={color}
              strokeWidth={strokeWidth}
              fill={properties.filled ? color : 'none'}
            />
          );
        }
        break;

      case 'text':
        if (points.length >= 1) {
          return (
            <SvgText
              key={key}
              x={points[0][0]}
              y={points[0][1]}
              fill={color}
              fontSize={properties.fontSize || 14}
              fontWeight={properties.fontWeight || 'normal'}
            >
              {properties.text || ''}
            </SvgText>
          );
        }
        break;

      default:
        return null;
    }
  };

  const renderCurrentDrawing = () => {
    if (!isDrawing || currentPoints.length === 0) return null;

    if ((activeTool === 'line' || activeTool === 'panel') && currentPoints.length === 2) {
      return (
        <Line
          x1={currentPoints[0][0]}
          y1={currentPoints[0][1]}
          x2={currentPoints[1][0]}
          y2={currentPoints[1][1]}
          stroke={activeColor}
          strokeWidth={activeTool === 'panel' ? Math.max(activeStrokeWidth + 2, 4) : activeStrokeWidth}
          strokeDasharray="5,5"
        />
      );
    }

    if (activeTool === 'rectangle' && currentPoints.length === 2) {
      const x = Math.min(currentPoints[0][0], currentPoints[1][0]);
      const y = Math.min(currentPoints[0][1], currentPoints[1][1]);
      const width = Math.abs(currentPoints[1][0] - currentPoints[0][0]);
      const height = Math.abs(currentPoints[1][1] - currentPoints[0][1]);
      return (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          fill="none"
          strokeDasharray="5,5"
        />
      );
    }

    if (activeTool === 'circle' && currentPoints.length === 2) {
      const [x1, y1] = currentPoints[0];
      const [x2, y2] = currentPoints[1];
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      return (
        <Circle
          cx={x1}
          cy={y1}
          r={radius}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          fill="none"
          strokeDasharray="5,5"
        />
      );
    }

    return null;
  };

  return (
    <View 
      style={styles.container}
      testID="cad-canvas-surface"
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleTouchStart}
      onResponderMove={handleTouchMove}
      onResponderRelease={handleTouchEnd}
    >
      <Svg 
        width={CANVAS_WIDTH} 
        height={CANVAS_HEIGHT} 
        style={[
          styles.canvas,
          backgroundColor === 'light' && styles.canvasLight
        ]}
      >
        <G transform={`translate(${viewportOffset.x}, ${viewportOffset.y})`}>
          {/* Grid background */}
          <G opacity={0.1}>
            {Array.from({ length: 20 }).map((_, i) => (
              <Line
                key={`v${i}`}
                x1={(i * CANVAS_WIDTH) / 20}
                y1={0}
                x2={(i * CANVAS_WIDTH) / 20}
                y2={CANVAS_HEIGHT}
                stroke={backgroundColor === 'light' ? '#000000' : '#ffffff'}
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: 15 }).map((_, i) => (
              <Line
                key={`h${i}`}
                x1={0}
                y1={(i * CANVAS_HEIGHT) / 15}
                x2={CANVAS_WIDTH}
                y2={(i * CANVAS_HEIGHT) / 15}
                stroke={backgroundColor === 'light' ? '#000000' : '#ffffff'}
                strokeWidth={1}
              />
            ))}
          </G>

          {/* Render all elements */}
          {elements.map((element, index) => renderElement(element, index))}

          {/* Render current drawing */}
          {renderCurrentDrawing()}
        </G>
      </Svg>

      {elements.length === 0 && !isDrawing && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {activeTool === 'select'
              ? 'Tap an element to select it'
              : activeTool === 'pan'
                ? 'Drag to pan the drafting view'
                : activeTool === 'panel'
                  ? 'Tap and drag to place a sheet panel line'
                  : 'Tap and drag to draw'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#333',
  },
  canvas: {
    backgroundColor: '#0a0a0a',
  },
  canvasLight: {
    backgroundColor: '#ffffff',
  },
  emptyState: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
});
