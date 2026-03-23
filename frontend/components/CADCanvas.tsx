import React, { useState, useRef } from 'react';
import { View, StyleSheet, Dimensions, Text, PanResponder } from 'react-native';
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
}

export default function CADCanvas({
  elements,
  onElementsChange,
  activeTool = 'select',
  activeColor = '#000000',
  activeStrokeWidth = 2,
}: CADCanvasProps) {
  const [currentPoints, setCurrentPoints] = useState<number[][]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeTool !== 'select',
      onMoveShouldSetPanResponder: () => activeTool !== 'select',
      onPanResponderGrant: (evt) => {
        if (activeTool === 'select') return;

        const { locationX, locationY } = evt.nativeEvent;
        setIsDrawing(true);
        setCurrentPoints([[locationX, locationY]]);
      },
      onPanResponderMove: (evt) => {
        if (!isDrawing || activeTool === 'select') return;

        const { locationX, locationY } = evt.nativeEvent;

        if (activeTool === 'line' || activeTool === 'rectangle') {
          setCurrentPoints([[currentPoints[0][0], currentPoints[0][1]], [locationX, locationY]]);
        } else if (activeTool === 'polygon') {
          setCurrentPoints([...currentPoints, [locationX, locationY]]);
        }
      },
      onPanResponderRelease: () => {
        if (!isDrawing || activeTool === 'select') return;

        if (currentPoints.length >= 2) {
          const newElement: CADElement = {
            id: `elem_${Date.now()}`,
            type: activeTool,
            points: currentPoints,
            properties: {
              color: activeColor,
              strokeWidth: activeStrokeWidth,
              layer: 'default',
            },
          };

          if (activeTool === 'circle') {
            const [x1, y1] = currentPoints[0];
            const [x2, y2] = currentPoints[1];
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
      },
    })
  ).current;

  const renderElement = (element: CADElement, index: number) => {
    const { type, points, properties } = element;
    const color = properties.color || '#000000';
    const strokeWidth = properties.strokeWidth || 2;
    const key = element.id || `element_${index}`;

    switch (type) {
      case 'line':
        if (points.length >= 2) {
          return (
            <Line
              key={key}
              x1={points[0][0]}
              y1={points[0][1]}
              x2={points[1][0]}
              y2={points[1][1]}
              stroke={color}
              strokeWidth={strokeWidth}
            />
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
            <Rect
              key={key}
              x={x}
              y={y}
              width={width}
              height={height}
              stroke={color}
              strokeWidth={strokeWidth}
              fill={properties.filled ? color : 'none'}
            />
          );
        }
        break;

      case 'circle':
        if (points.length >= 1 && properties.radius) {
          return (
            <Circle
              key={key}
              cx={points[0][0]}
              cy={points[0][1]}
              r={properties.radius}
              stroke={color}
              strokeWidth={strokeWidth}
              fill={properties.filled ? color : 'none'}
            />
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

    if (activeTool === 'line' && currentPoints.length === 2) {
      return (
        <Line
          x1={currentPoints[0][0]}
          y1={currentPoints[0][1]}
          x2={currentPoints[1][0]}
          y2={currentPoints[1][1]}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
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
    <View style={styles.container} {...panResponder.panHandlers}>
      <Svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={styles.canvas}>
        {/* Grid background */}
        <G opacity={0.1}>
          {Array.from({ length: 20 }).map((_, i) => (
            <Line
              key={`v${i}`}
              x1={(i * CANVAS_WIDTH) / 20}
              y1={0}
              x2={(i * CANVAS_WIDTH) / 20}
              y2={CANVAS_HEIGHT}
              stroke="#ffffff"
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
              stroke="#ffffff"
              strokeWidth={1}
            />
          ))}
        </G>

        {/* Render all elements */}
        {elements.map((element, index) => renderElement(element, index))}

        {/* Render current drawing */}
        {renderCurrentDrawing()}
      </Svg>

      {elements.length === 0 && !isDrawing && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {activeTool === 'select' ? 'Select a tool to start drawing' : 'Tap and drag to draw'}
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
