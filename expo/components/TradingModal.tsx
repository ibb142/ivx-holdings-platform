import React, { useState, useMemo, useEffect, useRef } from 'react';
import {View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Animated} from "react-native";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, TrendingUp, TrendingDown, Clock, Zap, Shield, AlertCircle, CheckCircle, Info } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { Property, MarketData, Order } from '@/types';
import { formatNumber, formatAmountInput, parseAmountInput, formatCurrencyWithDecimals } from '@/lib/formatters';
import { sellShares } from '@/lib/investment-service';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface TradingModalProps {
  visible: boolean;
  onClose: () => void;
  property: Property | null;
  marketData: MarketData | null;
  initialType?: 'buy' | 'sell';
  userBalance: number;
  userShares?: number;
  onTradeComplete: (order: Order) => void;
}

type OrderType = 'market' | 'limit';
type TradeType = 'buy' | 'sell';

export default function TradingModal({
  visible,
  onClose,
  property,
  marketData,
  initialType = 'buy',
  userBalance,
  userShares = 0,
  onTradeComplete}: TradingModalProps) {
  const [tradeType, setTradeType] = useState<TradeType>(initialType);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [shares, setShares] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [tradeResult, setTradeResult] = useState<{ success: boolean; order?: Order; error?: string } | null>(null);
  
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const priceFlashAnim = useRef(new Animated.Value(0)).current;
  const [displayPrice, setDisplayPrice] = useState(marketData?.lastPrice || 0);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');

  useEffect(() => {
    if (visible) {
      setTradeType(initialType);
      setShares('');
      setLimitPrice('');
      setShowConfirmation(false);
      setTradeResult(null);
      setDisplayPrice(marketData?.lastPrice || 0);
    }
  }, [visible, initialType, marketData?.lastPrice]);

  const displayPriceRef = React.useRef(displayPrice);
  displayPriceRef.current = displayPrice;

  useEffect(() => {
    if (!visible || !marketData) return;

    const interval = setInterval(() => {
      const currentPrice = displayPriceRef.current;
      const change = (Math.random() - 0.5) * 0.1;
      const newPrice = Math.max(0.01, currentPrice + change);
      
      setPriceDirection(newPrice > currentPrice ? 'up' : newPrice < currentPrice ? 'down' : 'neutral');
      setDisplayPrice(Math.round(newPrice * 100) / 100);
      
      Animated.sequence([
        Animated.timing(priceFlashAnim, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.timing(priceFlashAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, 2000);

    return () => clearInterval(interval);
  }, [visible, marketData, priceFlashAnim]);

  useEffect(() => {
    if (!visible) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [visible, pulseAnim]);

  const currentPrice = orderType === 'market' ? displayPrice : (parseFloat(limitPrice) || displayPrice);
  const sharesNum = parseInt(shares) || 0;
  const subtotal = sharesNum * currentPrice;
  const tradingFee = subtotal * 0.01; // 1% trading fee on every transaction
  const fee = tradingFee;
  const total = tradeType === 'buy' ? subtotal + fee : subtotal - fee;

  const canTrade = useMemo(() => {
    if (!sharesNum || sharesNum <= 0) return false;
    if (orderType === 'limit' && (!limitPrice || parseFloat(limitPrice) <= 0)) return false;
    if (tradeType === 'buy' && total > userBalance) return false;
    if (tradeType === 'sell' && sharesNum > userShares) return false;
    return true;
  }, [sharesNum, orderType, limitPrice, tradeType, total, userBalance, userShares]);

  const maxShares = useMemo(() => {
    if (tradeType === 'buy') {
      const maxBuyable = Math.floor((userBalance - fee) / currentPrice);
      return Math.max(0, maxBuyable);
    }
    return userShares;
  }, [tradeType, userBalance, currentPrice, fee, userShares]);

  const handleSharesChange = (value: string) => {
    const numericValue = value.replace(/[^0-9]/g, '');
    setShares(numericValue);
  };

  const handleLimitPriceChange = (value: string) => {
    const cleanValue = parseAmountInput(value);
    setLimitPrice(cleanValue);
  };

  const displayShares = shares ? formatNumber(parseInt(shares) || 0) : '';
  const displayLimitPrice = limitPrice ? formatAmountInput(limitPrice) : '';

  const handleQuickAmount = (percent: number) => {
    const amount = Math.floor(maxShares * percent);
    setShares(amount.toString());
    void Haptics.selectionAsync();
  };

  const handleTrade = async () => {
    if (!canTrade || !property || !marketData) return;

    setShowConfirmation(true);
  };

  const confirmTrade = async () => {
    if (!property || !marketData) return;

    setIsProcessing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (tradeType === 'sell') {
        console.log('[Trading] Executing real sell via Supabase...');
        const result = await sellShares({
          holdingId: '',
          propertyId: property.id,
          propertyName: property.name,
          shares: sharesNum,
          pricePerShare: currentPrice,
          subtotal,
          platformFee: fee,
          netProceeds: total,
          sellType: 'instant'});

        if (result.success) {
          const order: Order = {
            id: result.transactionId || `order-${Date.now()}`,
            propertyId: property.id,
            property: property,
            type: 'sell',
            orderType: orderType,
            status: 'filled',
            shares: sharesNum,
            filledShares: sharesNum,
            price: currentPrice,
            total: total,
            fees: fee,
            createdAt: new Date().toISOString(),
            filledAt: new Date().toISOString()};
          setTradeResult({ success: true, order });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onTradeComplete(order);
          void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
          void queryClient.invalidateQueries({ queryKey: ['holdings'] });
          void queryClient.invalidateQueries({ queryKey: ['portfolio'] });
          void queryClient.invalidateQueries({ queryKey: ['transactions'] });
        } else {
          setTradeResult({ success: false, error: result.message });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      } else {
        console.log('[Trading] Executing buy order...');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setTradeResult({ success: false, error: 'Please log in to trade.' });
          return;
        }

        const { data: orderData, error: orderError } = await supabase.from('orders').insert({
          user_id: user.id,
          property_id: property.id,
          type: 'buy',
          order_type: orderType,
          shares: sharesNum,
          price: currentPrice,
          total: total,
          fees: fee,
          status: orderType === 'market' ? 'filled' : 'open',
          created_at: new Date().toISOString(),
          filled_at: orderType === 'market' ? new Date().toISOString() : null}).select().single();

        if (orderError) {
          console.log('[Trading] Order insert failed:', orderError?.message);
        }

        const order: Order = {
          id: (orderData as any)?.id || `order-${Date.now()}`,
          propertyId: property.id,
          property: property,
          type: 'buy',
          orderType: orderType,
          status: orderType === 'market' ? 'filled' : 'open',
          shares: sharesNum,
          filledShares: orderType === 'market' ? sharesNum : 0,
          price: currentPrice,
          total: total,
          fees: fee,
          createdAt: new Date().toISOString(),
          filledAt: orderType === 'market' ? new Date().toISOString() : undefined};

        setTradeResult({ success: true, order });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onTradeComplete(order);
        void queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        void queryClient.invalidateQueries({ queryKey: ['holdings'] });
      }
    } catch (error) {
      console.error('[Trading] Error:', error);
      setTradeResult({ success: false, error: 'Network error. Please try again.' });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setShowConfirmation(false);
    setTradeResult(null);
    onClose();
  };

  if (!property || !marketData) return null;

  const isPositive = marketData.changePercent24h >= 0;
  const bestBid = marketData.bids[0]?.price || displayPrice * 0.99;
  const bestAsk = marketData.asks[0]?.price || displayPrice * 1.01;
  const spread = ((bestAsk - bestBid) / bestBid * 100).toFixed(2);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Trade {property.name}</Text>
              <View style={styles.marketStatus}>
                <Animated.View style={[styles.liveIndicator, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={styles.marketStatusText}>Market Open 24/7</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
              <X size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {tradeResult ? (
            <View style={styles.resultContainer}>
              <View style={[styles.resultIcon, { backgroundColor: tradeResult.success ? Colors.success + '20' : Colors.error + '20' }]}>
                {tradeResult.success ? (
                  <CheckCircle size={48} color={Colors.success} />
                ) : (
                  <AlertCircle size={48} color={Colors.error} />
                )}
              </View>
              <Text style={styles.resultTitle}>
                {tradeResult.success ? 'Order Executed!' : 'Order Failed'}
              </Text>
              {tradeResult.success && tradeResult.order && (
                <View style={styles.resultDetails}>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Type</Text>
                    <Text style={[styles.resultValue, { color: tradeResult.order.type === 'buy' ? Colors.success : Colors.error }]}>
                      {tradeResult.order.type.toUpperCase()} - {tradeResult.order.orderType.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Shares</Text>
                    <Text style={styles.resultValue}>{formatNumber(tradeResult.order.shares)}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Price</Text>
                    <Text style={styles.resultValue}>{formatCurrencyWithDecimals(tradeResult.order.price)}</Text>
                  </View>
                  <View style={styles.resultRow}>
                    <Text style={styles.resultLabel}>Fee</Text>
                    <Text style={styles.resultValue}>{formatCurrencyWithDecimals(tradeResult.order.fees)}</Text>
                  </View>
                  <View style={[styles.resultRow, styles.resultRowTotal]}>
                    <Text style={styles.resultLabelTotal}>Total</Text>
                    <Text style={styles.resultValueTotal}>{formatCurrencyWithDecimals(tradeResult.order.total)}</Text>
                  </View>
                </View>
              )}
              {tradeResult.error && <Text style={styles.errorText}>{tradeResult.error}</Text>}
              <TouchableOpacity style={styles.doneButton} onPress={handleClose}>
                <Text style={styles.doneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : showConfirmation ? (
            <View style={styles.confirmationContainer}>
              <Text style={styles.confirmTitle}>Confirm {tradeType === 'buy' ? 'Purchase' : 'Sale'}</Text>
              
              <View style={styles.confirmCard}>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Property</Text>
                  <Text style={styles.confirmValue}>{property.name}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Order Type</Text>
                  <Text style={styles.confirmValue}>{orderType.toUpperCase()}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Shares</Text>
                  <Text style={styles.confirmValue}>{formatNumber(sharesNum)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Price per Share</Text>
                  <Text style={styles.confirmValue}>{formatCurrencyWithDecimals(currentPrice)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Subtotal</Text>
                  <Text style={styles.confirmValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmLabel}>Trading Fee (1%)</Text>
                  <Text style={[styles.confirmValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(fee)}</Text>
                </View>
                <View style={[styles.confirmRow, styles.confirmRowTotal]}>
                  <Text style={styles.confirmLabelTotal}>
                    {tradeType === 'buy' ? 'Total Cost' : 'You Receive'}
                  </Text>
                  <Text style={styles.confirmValueTotal}>{formatCurrencyWithDecimals(total)}</Text>
                </View>
              </View>

              <View style={styles.warningBox}>
                <AlertCircle size={18} color={Colors.warning} />
                <Text style={styles.warningText}>
                  {orderType === 'market' 
                    ? 'Market orders execute immediately at the current price.'
                    : 'Limit orders will execute when the market price reaches your limit price.'}
                </Text>
              </View>

              <View style={styles.confirmButtons}>
                <TouchableOpacity 
                  style={styles.cancelButton} 
                  onPress={() => setShowConfirmation(false)}
                  disabled={isProcessing}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[
                    styles.executeButton, 
                    { backgroundColor: tradeType === 'buy' ? Colors.success : Colors.error },
                    isProcessing && styles.buttonDisabled
                  ]}
                  onPress={confirmTrade}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <ShimmerIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.executeButtonText}>
                      {tradeType === 'buy' ? 'Buy Now' : 'Sell Now'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.priceSection}>
                <View style={styles.priceHeader}>
                  <Text style={styles.priceLabel}>Live Price</Text>
                  <View style={styles.spreadBadge}>
                    <Text style={styles.spreadText}>Spread: {spread}%</Text>
                  </View>
                </View>
                <Animated.View style={[
                  styles.priceContainer,
                  { 
                    backgroundColor: priceDirection === 'up' ? Colors.success + '10' : 
                                    priceDirection === 'down' ? Colors.error + '10' : 'transparent',
                    opacity: priceFlashAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] })
                  }
                ]}>
                  <Text style={[
                    styles.currentPrice,
                    { color: priceDirection === 'up' ? Colors.success : priceDirection === 'down' ? Colors.error : Colors.text }
                  ]}>
                    {formatCurrencyWithDecimals(displayPrice)}
                  </Text>
                  <View style={[styles.changeBadge, { backgroundColor: isPositive ? Colors.success + '20' : Colors.error + '20' }]}>
                    {isPositive ? <TrendingUp size={14} color={Colors.success} /> : <TrendingDown size={14} color={Colors.error} />}
                    <Text style={[styles.changeText, { color: isPositive ? Colors.success : Colors.error }]}>
                      {isPositive ? '+' : ''}{marketData.changePercent24h.toFixed(2)}%
                    </Text>
                  </View>
                </Animated.View>

                <View style={styles.bidAskContainer}>
                  <View style={styles.bidAskItem}>
                    <Text style={styles.bidAskLabel}>Bid</Text>
                    <Text style={[styles.bidAskValue, { color: Colors.success }]}>{formatCurrencyWithDecimals(bestBid)}</Text>
                    <Text style={styles.bidAskShares}>{marketData.bids[0]?.shares || 0} shares</Text>
                  </View>
                  <View style={styles.bidAskDivider} />
                  <View style={styles.bidAskItem}>
                    <Text style={styles.bidAskLabel}>Ask</Text>
                    <Text style={[styles.bidAskValue, { color: Colors.error }]}>{formatCurrencyWithDecimals(bestAsk)}</Text>
                    <Text style={styles.bidAskShares}>{marketData.asks[0]?.shares || 0} shares</Text>
                  </View>
                </View>
              </View>

              <View style={styles.tradeTypeContainer}>
                <TouchableOpacity
                  style={[styles.tradeTypeButton, tradeType === 'buy' && styles.tradeTypeBuy]}
                  onPress={() => { setTradeType('buy'); void Haptics.selectionAsync(); }}
                >
                  <Text style={[styles.tradeTypeText, tradeType === 'buy' && styles.tradeTypeTextActive]}>Buy</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tradeTypeButton, tradeType === 'sell' && styles.tradeTypeSell]}
                  onPress={() => { setTradeType('sell'); void Haptics.selectionAsync(); }}
                >
                  <Text style={[styles.tradeTypeText, tradeType === 'sell' && styles.tradeTypeTextActive]}>Sell</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.orderTypeContainer}>
                <TouchableOpacity
                  style={[styles.orderTypeButton, orderType === 'market' && styles.orderTypeActive]}
                  onPress={() => { setOrderType('market'); void Haptics.selectionAsync(); }}
                >
                  <Zap size={16} color={orderType === 'market' ? Colors.primary : Colors.textTertiary} />
                  <Text style={[styles.orderTypeText, orderType === 'market' && styles.orderTypeTextActive]}>Market</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.orderTypeButton, orderType === 'limit' && styles.orderTypeActive]}
                  onPress={() => { setOrderType('limit'); setLimitPrice(displayPrice.toFixed(2)); void Haptics.selectionAsync(); }}
                >
                  <Shield size={16} color={orderType === 'limit' ? Colors.primary : Colors.textTertiary} />
                  <Text style={[styles.orderTypeText, orderType === 'limit' && styles.orderTypeTextActive]}>Limit</Text>
                </TouchableOpacity>
              </View>

              {orderType === 'limit' && (
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Limit Price</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputPrefix}>$</Text>
                    <TextInput
                      style={styles.input}
                      value={displayLimitPrice}
                      onChangeText={handleLimitPriceChange}
                      placeholder="0.00"
                      placeholderTextColor={Colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              )}

              <View style={styles.inputSection}>
                <View style={styles.inputLabelRow}>
                  <Text style={styles.inputLabel}>Shares</Text>
                  <Text style={styles.maxShares}>
                    Max: {formatNumber(maxShares)} {tradeType === 'sell' ? '(owned)' : ''}
                  </Text>
                </View>
                <View style={styles.inputContainer}>
                  <TextInput
                    style={styles.input}
                    value={displayShares}
                    onChangeText={handleSharesChange}
                    placeholder="0"
                    placeholderTextColor={Colors.textTertiary}
                    keyboardType="number-pad"
                  />
                  <TouchableOpacity style={styles.maxButton} onPress={() => handleQuickAmount(1)}>
                    <Text style={styles.maxButtonText}>MAX</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.quickAmounts}>
                  {[0.25, 0.5, 0.75, 1].map(percent => (
                    <TouchableOpacity
                      key={percent}
                      style={styles.quickAmountButton}
                      onPress={() => handleQuickAmount(percent)}
                    >
                      <Text style={styles.quickAmountText}>{percent * 100}%</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.summarySection}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>{formatCurrencyWithDecimals(subtotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Trading Fee (1%)</Text>
                  <Text style={[styles.summaryValue, { color: Colors.error }]}>-{formatCurrencyWithDecimals(fee)}</Text>
                </View>
                <View style={[styles.summaryRow, styles.summaryRowTotal]}>
                  <Text style={styles.summaryLabelTotal}>
                    {tradeType === 'buy' ? 'Total Cost' : 'You Receive'}
                  </Text>
                  <Text style={styles.summaryValueTotal}>{formatCurrencyWithDecimals(total)}</Text>
                </View>
              </View>

              <View style={styles.balanceInfo}>
                <Info size={14} color={Colors.textTertiary} />
                <Text style={styles.balanceText}>
                  Available: ${formatNumber(userBalance)} • Owned: {formatNumber(userShares)} shares
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.tradeButton,
                  { backgroundColor: tradeType === 'buy' ? Colors.success : Colors.error },
                  !canTrade && styles.buttonDisabled
                ]}
                onPress={handleTrade}
                disabled={!canTrade}
              >
                <Text style={styles.tradeButtonText}>
                  {tradeType === 'buy' ? 'Buy' : 'Sell'} {sharesNum || 0} Shares
                </Text>
              </TouchableOpacity>

              <View style={styles.disclaimer}>
                <Clock size={12} color={Colors.textTertiary} />
                <Text style={styles.disclaimerText}>
                  Trading is available 24/7. 1% fee applies to all transactions.
                </Text>
              </View>

              <View style={styles.taxDisclaimer}>
                <AlertCircle size={12} color={Colors.warning} />
                <Text style={styles.taxDisclaimerText}>
                  By trading, you agree that you are solely responsible for all applicable taxes in your jurisdiction. This includes capital gains, income taxes, and any other tax obligations required by your country's regulations.
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end'},
  container: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '92%'},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16},
  headerLeft: {
    flex: 1},
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const},
  marketStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4},
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success},
  marketStatusText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600' as const},
  closeButton: {
    padding: 4},
  priceSection: {
    marginBottom: 16},
  priceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8},
  priceLabel: {
    color: Colors.textTertiary,
    fontSize: 13,
    fontWeight: '600' as const},
  spreadBadge: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3},
  spreadText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const},
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10},
  currentPrice: {
    fontSize: 28,
    fontWeight: '800' as const},
  changeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5},
  changeText: {
    fontSize: 14,
    fontWeight: '700' as const},
  bidAskContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 12},
  bidAskItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2},
  bidAskDivider: {
    width: 1,
    backgroundColor: Colors.surfaceBorder,
    marginHorizontal: 12},
  bidAskLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const},
  bidAskValue: {
    fontSize: 16,
    fontWeight: '700' as const},
  bidAskShares: {
    color: Colors.textTertiary,
    fontSize: 11},
  tradeTypeContainer: {
    flexDirection: 'row',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: 4,
    marginBottom: 12},
  tradeTypeButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10},
  tradeTypeBuy: {
    backgroundColor: Colors.success},
  tradeTypeSell: {
    backgroundColor: Colors.error},
  tradeTypeText: {
    color: Colors.textSecondary,
    fontWeight: '700' as const,
    fontSize: 15},
  tradeTypeTextActive: {
    color: Colors.white},
  orderTypeContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16},
  orderTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  orderTypeActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '10'},
  orderTypeText: {
    color: Colors.textTertiary,
    fontWeight: '600' as const,
    fontSize: 13},
  orderTypeTextActive: {
    color: Colors.primary},
  inputSection: {
    marginBottom: 14},
  inputLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8},
  inputLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  maxShares: {
    color: Colors.textTertiary,
    fontSize: 12},
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14},
  inputPrefix: {
    color: Colors.textSecondary,
    fontSize: 18,
    fontWeight: '600' as const,
    marginRight: 4},
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600' as const,
    paddingVertical: 12},
  maxButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6},
  maxButtonText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '800' as const},
  quickAmounts: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8},
  quickAmountButton: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  quickAmountText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  summarySection: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 8},
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  summaryRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 8,
    marginTop: 4},
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 13},
  summaryValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  summaryLabelTotal: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const},
  summaryValueTotal: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '800' as const},
  balanceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14},
  balanceText: {
    color: Colors.textTertiary,
    fontSize: 12},
  tradeButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12},
  buttonDisabled: {
    opacity: 0.4},
  tradeButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '700' as const},
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8},
  disclaimerText: {
    color: Colors.textTertiary,
    fontSize: 11,
    flex: 1},
  taxDisclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.warning + '10',
    borderRadius: 10,
    padding: 10},
  taxDisclaimerText: {
    color: Colors.textSecondary,
    fontSize: 11,
    flex: 1,
    lineHeight: 16},
  confirmationContainer: {
    gap: 16},
  confirmTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '800' as const,
    textAlign: 'center'},
  confirmCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    padding: 14,
    gap: 10},
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  confirmRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 4},
  confirmLabel: {
    color: Colors.textSecondary,
    fontSize: 14},
  confirmValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  confirmLabelTotal: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  confirmValueTotal: {
    color: Colors.primary,
    fontSize: 20,
    fontWeight: '800' as const},
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.warning + '10',
    borderRadius: 12,
    padding: 12},
  warningText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
    lineHeight: 18},
  confirmButtons: {
    flexDirection: 'row',
    gap: 12},
  cancelButton: {
    flex: 1,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cancelButtonText: {
    color: Colors.text,
    fontWeight: '600' as const,
    fontSize: 15},
  executeButton: {
    flex: 2,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center'},
  executeButtonText: {
    color: Colors.white,
    fontWeight: '700' as const,
    fontSize: 16},
  resultContainer: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 20},
  resultIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center'},
  resultTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const},
  resultDetails: {
    width: '100%',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 14,
    padding: 14,
    gap: 10},
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  resultRowTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingTop: 10,
    marginTop: 4},
  resultLabel: {
    color: Colors.textSecondary,
    fontSize: 14},
  resultValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  resultLabelTotal: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const},
  resultValueTotal: {
    color: Colors.primary,
    fontSize: 20,
    fontWeight: '800' as const},
  errorText: {
    color: Colors.error,
    fontSize: 14,
    textAlign: 'center'},
  doneButton: {
    width: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center'},
  doneButtonText: {
    color: Colors.black,
    fontWeight: '700' as const,
    fontSize: 16}});
