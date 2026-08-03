/**
 * =============================================================================
 * PRICE CHART COMPONENT - components/PriceChart.tsx
 * =============================================================================
 * 
 * Interactive SVG line chart for displaying property price history.
 * Shows price trends with gradient fill, time range selector, and volume.
 * 
 * FEATURES:
 * ---------
 * - Smooth curved line chart using SVG paths
 * - Gradient fill below the line
 * - Current price display with change amount/percentage
 * - Time range selector: 1D, 1W, 1M, 3M, 1Y, ALL
 * - 24h volume display (optional)
 * - Green/red coloring based on price direction
 * - Animated dot at current price point
 * 
 * PROPS:
 * ------
 * - data: PricePoint[] - Array of { date, price, volume } objects
 * - timeRange: TimeRange - Currently selected range ('1D' | '1W' | etc.)
 * - onTimeRangeChange: (range: TimeRange) => void - Callback when range changes
 * - showVolume?: boolean - Show 24h volume section (default: true)
 * 
 * CHART DIMENSIONS:
 * -----------------
 * - Width: Screen width - 40px
 * - Height: 180px
 * - Padding: 20px on all sides
 * 
 * DATA FILTERING:
 * ---------------
 * Data is automatically filtered based on selected time range:
 * - 1D: Last 24 hours
 * - 1W: Last 7 days
 * - 1M: Last 30 days
 * - 3M: Last 3 months
 * - 1Y: Last 12 months
 * - ALL: All available data
 * 
 * USAGE:
 * ------
 * import PriceChart from '@/components/PriceChart';
 * 
 * <PriceChart
 *   data={property.priceHistory}
 *   timeRange={selectedRange}
 *   onTimeRangeChange={setSelectedRange}
 * />
 * =============================================================================
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { PricePoint, TimeRange } from '@/types';
import Colors from '@/constants/colors';

const CHART_HEIGHT = 180;
const CHART_PADDING = 20;

interface PriceChartProps {
  data: PricePoint[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  showVolume?: boolean;
}

const TIME_RANGES: TimeRange[] = ['1D', '1W', '1M', '3M', '1Y', 'ALL'];

export default function PriceChart({
  data,
  timeRange,
  onTimeRangeChange,
  showVolume = true}: PriceChartProps) {
  const { width: screenWidth } = useWindowDimensions();
  const CHART_WIDTH = screenWidth - 40;
  const filteredData = useMemo(() => {
    const now = new Date();
    let filterDate = new Date();
    
    switch (timeRange) {
      case '1D':
        filterDate.setDate(now.getDate() - 1);
        break;
      case '1W':
        filterDate.setDate(now.getDate() - 7);
        break;
      case '1M':
        filterDate.setMonth(now.getMonth() - 1);
        break;
      case '3M':
        filterDate.setMonth(now.getMonth() - 3);
        break;
      case '1Y':
        filterDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'ALL':
        return data;
    }
    
    return data.filter(point => new Date(point.date) >= filterDate);
  }, [data, timeRange]);

  const { pathData, gradientPath, minPrice, maxPrice, priceChange, priceChangePercent } = useMemo(() => {
    if (filteredData.length < 2) {
      return { pathData: '', gradientPath: '', minPrice: 0, maxPrice: 0, priceChange: 0, priceChangePercent: 0 };
    }

    const prices = filteredData.map(d => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const firstPrice = filteredData[0].price;
    const lastPrice = filteredData[filteredData.length - 1].price;
    const change = lastPrice - firstPrice;
    const changePercent = (change / firstPrice) * 100;

    const points = filteredData.map((point, index) => {
      const x = (index / (filteredData.length - 1)) * (CHART_WIDTH - CHART_PADDING * 2) + CHART_PADDING;
      const y = CHART_HEIGHT - CHART_PADDING - ((point.price - min) / range) * (CHART_HEIGHT - CHART_PADDING * 2);
      return { x, y };
    });

    const path = points.reduce((acc, point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      const prev = points[i - 1];
      const cpX = (prev.x + point.x) / 2;
      return `${acc} Q ${cpX} ${prev.y} ${point.x} ${point.y}`;
    }, '');

    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    const gradient = `${path} L ${lastPoint.x} ${CHART_HEIGHT} L ${firstPoint.x} ${CHART_HEIGHT} Z`;

    return {
      pathData: path,
      gradientPath: gradient,
      minPrice: min,
      maxPrice: max,
      priceChange: change,
      priceChangePercent: changePercent};
  }, [filteredData, CHART_WIDTH]);

  const isPositive = priceChange >= 0;
  const chartColor = isPositive ? Colors.chartGreen : Colors.chartRed;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.currentPrice}>
            ${filteredData[filteredData.length - 1]?.price.toFixed(2) || '0.00'}
          </Text>
          <View style={styles.changeRow}>
            <Text style={[styles.changeText, { color: chartColor }]}>
              {isPositive ? '+' : ''}${priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePercent.toFixed(2)}%)
            </Text>
            <Text style={styles.periodText}>{timeRange}</Text>
          </View>
        </View>
      </View>

      <View style={styles.chartContainer}>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          <Defs>
            <LinearGradient id="chartGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <Stop offset="0%" stopColor={chartColor} stopOpacity={0.3} />
              <Stop offset="100%" stopColor={chartColor} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          
          {gradientPath && (
            <Path d={gradientPath} fill="url(#chartGradient)" />
          )}
          
          {pathData && (
            <Path
              d={pathData}
              fill="none"
              stroke={chartColor}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {filteredData.length > 0 && (
            <Circle
              cx={CHART_WIDTH - CHART_PADDING}
              cy={
                CHART_HEIGHT -
                CHART_PADDING -
                ((filteredData[filteredData.length - 1].price - minPrice) /
                  (maxPrice - minPrice || 1)) *
                  (CHART_HEIGHT - CHART_PADDING * 2)
              }
              r={4}
              fill={chartColor}
            />
          )}
        </Svg>
      </View>

      <View style={styles.timeRangeContainer}>
        {TIME_RANGES.map((range) => (
          <TouchableOpacity
            key={range}
            style={[
              styles.timeRangeButton,
              timeRange === range && styles.timeRangeButtonActive,
            ]}
            onPress={() => onTimeRangeChange(range)}
          >
            <Text
              style={[
                styles.timeRangeText,
                timeRange === range && styles.timeRangeTextActive,
              ]}
            >
              {range}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {showVolume && (
        <View style={styles.volumeSection}>
          <Text style={styles.volumeLabel}>24h Volume</Text>
          <Text style={styles.volumeValue}>
            ${new Intl.NumberFormat('en-US').format(filteredData[filteredData.length - 1]?.volume || 0)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  header: {
    marginBottom: 16},
  currentPrice: {
    fontSize: 28,
    fontWeight: '700' as const,
    color: Colors.text},
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4},
  changeText: {
    fontSize: 14,
    fontWeight: '600' as const},
  periodText: {
    fontSize: 12,
    color: Colors.textTertiary},
  chartContainer: {
    marginHorizontal: -16},
  timeRangeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    padding: 4},
  timeRangeButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8},
  timeRangeButtonActive: {
    backgroundColor: Colors.surface},
  timeRangeText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textTertiary},
  timeRangeTextActive: {
    color: Colors.primary},
  volumeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  volumeLabel: {
    fontSize: 13,
    color: Colors.textTertiary},
  volumeValue: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text}});
