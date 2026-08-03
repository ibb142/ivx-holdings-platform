import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { generateQRMatrix } from '@/lib/qr-generator';

interface QRCodeViewProps {
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  quietZone?: number;
}

function QRCodeViewInner({ value, size = 200, color = '#000', backgroundColor = '#fff', quietZone = 4 }: QRCodeViewProps) {
  const { rects, totalModules } = useMemo(() => {
    const { matrix, size: matrixSize } = generateQRMatrix(value);
    const total = matrixSize + quietZone * 2;
    const cells: Array<{ x: number; y: number }> = [];

    for (let r = 0; r < matrixSize; r++) {
      for (let c = 0; c < matrixSize; c++) {
        if (matrix[r][c] === 1) {
          cells.push({ x: c + quietZone, y: r + quietZone });
        }
      }
    }

    return { rects: cells, totalModules: total };
  }, [value, quietZone]);

  const cellSize = size / totalModules;

  return (
    <View style={[styles.container, { width: size, height: size, backgroundColor }]} testID="qr-code-view">
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Rect x={0} y={0} width={size} height={size} fill={backgroundColor} />
        {rects.map((cell, index) => (
          <Rect
            key={`${cell.x}-${cell.y}-${index}`}
            x={cell.x * cellSize}
            y={cell.y * cellSize}
            width={cellSize + 0.5}
            height={cellSize + 0.5}
            fill={color}
          />
        ))}
      </Svg>
    </View>
  );
}

const QRCodeView = React.memo(QRCodeViewInner);
export default QRCodeView;

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden' as const,
    borderRadius: 8}});
