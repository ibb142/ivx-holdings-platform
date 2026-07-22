/**
 * =============================================================================
 * HOLDING CARD COMPONENT - components/HoldingCard.tsx
 * =============================================================================
 * 
 * Displays a user's investment holding in a property with P&L information.
 * Used in the Portfolio screen to show owned shares and performance.
 * 
 * DISPLAY INFO:
 * -------------
 * - Property thumbnail image
 * - Property name
 * - Number of shares owned
 * - Current value in USD
 * - Unrealized P&L (profit/loss) with percentage
 * - Green/red coloring based on positive/negative returns
 * 
 * RESPONSIVE:
 * -----------
 * - Automatically adjusts layout for smaller screens (< 375px)
 * - Compact mode reduces font sizes, padding, and image size
 * 
 * PROPS:
 * ------
 * - holding: Holding - The holding data from @/types
 * 
 * NAVIGATION:
 * -----------
 * Tapping the card navigates to /property/[propertyId] detail page.
 * 
 * PERFORMANCE:
 * ------------
 * - Uses React.memo() to prevent unnecessary re-renders
 * - useMemo() for P&L positive/negative calculation
 * - useCallback() for navigation handler
 * 
 * USAGE:
 * ------
 * import HoldingCard from '@/components/HoldingCard';
 * 
 * <HoldingCard holding={userHolding} />
 * =============================================================================
 */

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { TrendingUp, TrendingDown } from 'lucide-react-native';
import { useRouter, Href } from 'expo-router';
import { Holding } from '@/types';
import Colors from '@/constants/colors';

interface HoldingCardProps {
  holding: Holding;
}

const HoldingCard = memo(function HoldingCard({ holding }: HoldingCardProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isCompact = width < 375;
  const isPositive = useMemo(() => holding.unrealizedPnL >= 0, [holding.unrealizedPnL]);

  const handlePress = useCallback(() => {
    router.push(`/property/${holding.propertyId}` as Href);
  }, [router, holding.propertyId]);

  return (
    <TouchableOpacity
      style={[styles.container, isCompact && styles.containerCompact]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${holding.property.name}, ${holding.shares} shares, current value ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(holding.currentValue)}, ${isPositive ? 'up' : 'down'} ${Math.abs(holding.unrealizedPnLPercent).toFixed(1)} percent`}
      accessibilityHint="Opens property details"
      testID={`holding-card-${holding.propertyId}`}
    >
      <Image
        source={{ uri: holding.property.images[0] }}
        style={[styles.image, isCompact && styles.imageCompact]}
        accessibilityLabel={`Photo of ${holding.property.name}`}
      />
      
      <View style={[styles.content, isCompact && styles.contentCompact]}>
        <View style={styles.header}>
          <Text style={[styles.name, isCompact && styles.nameCompact]} numberOfLines={1}>{holding.property.name}</Text>
          <Text style={[styles.shares, isCompact && styles.sharesCompact]}>{holding.shares} shares</Text>
        </View>
        
        <View style={styles.footer}>
          <View style={styles.valueContainer}>
            <Text style={[styles.valueLabel, isCompact && styles.valueLabelCompact]}>Current Value</Text>
            <Text style={[styles.value, isCompact && styles.valueCompact]}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(holding.currentValue)}</Text>
          </View>
          
          <View style={styles.pnlContainer}>
            <View style={[styles.pnlBadge, isCompact && styles.pnlBadgeCompact, { backgroundColor: isPositive ? Colors.success + '20' : Colors.error + '20' }]}>
              {isPositive ? (
                <TrendingUp size={isCompact ? 12 : 14} color={Colors.success} />
              ) : (
                <TrendingDown size={isCompact ? 12 : 14} color={Colors.error} />
              )}
              <Text style={[styles.pnlText, isCompact && styles.pnlTextCompact, { color: isPositive ? Colors.success : Colors.error }]}>
                {isPositive ? '+' : ''}{holding.unrealizedPnLPercent.toFixed(isCompact ? 1 : 2)}%
              </Text>
            </View>
            <Text style={[styles.pnlAmount, isCompact && styles.pnlAmountCompact, { color: isPositive ? Colors.success : Colors.error }]}>
              {isPositive ? '+' : ''}{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(holding.unrealizedPnL))}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default HoldingCard;

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  containerCompact: {
    padding: 10,
  },
  image: {
    width: 70,
    height: 70,
    borderRadius: 8,
  },
  imageCompact: {
    width: 56,
    height: 56,
    borderRadius: 6,
  },
  content: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  contentCompact: {
    marginLeft: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  nameCompact: {
    fontSize: 13,
    marginRight: 4,
  },
  shares: {
    fontSize: 12,
    color: Colors.textSecondary,
    backgroundColor: Colors.backgroundTertiary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  sharesCompact: {
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  valueContainer: {
    flexShrink: 1,
  },
  valueLabel: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginBottom: 2,
  },
  valueLabelCompact: {
    fontSize: 10,
  },
  value: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  valueCompact: {
    fontSize: 14,
  },
  pnlContainer: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  pnlBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 2,
  },
  pnlBadgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    gap: 2,
  },
  pnlText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  pnlTextCompact: {
    fontSize: 10,
  },
  pnlAmount: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  pnlAmountCompact: {
    fontSize: 10,
  },
});
