import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity} from 'react-native';
import { CreditCard, Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';

interface CardInputFormProps {
  onCardChange: (card: CardData | null) => void;
  disabled?: boolean;
}

export interface CardData {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
  name: string;
  isValid: boolean;
}

const TEST_CARDS = [
  { label: 'Visa (Success)', number: '4242424242424242' },
  { label: 'Mastercard', number: '5555555555554444' },
  { label: 'Amex', number: '378282246310005' },
  { label: 'Declined', number: '4000000000000002' },
];

export default function CardInputForm({ onCardChange, disabled }: CardInputFormProps) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [showTestCards, setShowTestCards] = useState(false);

  const formatCardNumber = useCallback((text: string) => {
    const cleaned = text.replace(/\D/g, '');
    const limited = cleaned.slice(0, 16);
    const formatted = limited.replace(/(\d{4})(?=\d)/g, '$1 ');
    return formatted;
  }, []);

  const formatExpiry = useCallback((text: string) => {
    const cleaned = text.replace(/\D/g, '');
    const limited = cleaned.slice(0, 4);
    if (limited.length >= 2) {
      return `${limited.slice(0, 2)}/${limited.slice(2)}`;
    }
    return limited;
  }, []);

  const getCardBrand = useCallback((number: string) => {
    const cleaned = number.replace(/\s/g, '');
    if (cleaned.startsWith('4')) return 'Visa';
    if (cleaned.startsWith('5')) return 'Mastercard';
    if (cleaned.startsWith('37') || cleaned.startsWith('34')) return 'Amex';
    if (cleaned.startsWith('6')) return 'Discover';
    return null;
  }, []);

  const validateCard = useCallback(() => {
    const cleanedNumber = cardNumber.replace(/\s/g, '');
    const isNumberValid = cleanedNumber.length >= 15;
    const [month, year] = expiry.split('/');
    const isExpiryValid = month && year && parseInt(month) >= 1 && parseInt(month) <= 12 && year.length === 2;
    const isCvcValid = cvc.length >= 3;
    const isNameValid = name.trim().length > 0;

    return isNumberValid && isExpiryValid && isCvcValid && isNameValid;
  }, [cardNumber, expiry, cvc, name]);

  const updateParent = useCallback((
    newNumber: string,
    newExpiry: string,
    newCvc: string,
    newName: string
  ) => {
    const cleanedNumber = newNumber.replace(/\s/g, '');
    const [month, year] = newExpiry.split('/');
    const isValid = cleanedNumber.length >= 15 && month && year && newCvc.length >= 3 && newName.trim().length > 0;

    if (isValid) {
      onCardChange({
        number: cleanedNumber,
        expMonth: month,
        expYear: year,
        cvc: newCvc,
        name: newName,
        isValid: true});
    } else {
      onCardChange(null);
    }
  }, [onCardChange]);

  const handleCardNumberChange = (text: string) => {
    const formatted = formatCardNumber(text);
    setCardNumber(formatted);
    updateParent(formatted, expiry, cvc, name);
  };

  const handleExpiryChange = (text: string) => {
    const formatted = formatExpiry(text);
    setExpiry(formatted);
    updateParent(cardNumber, formatted, cvc, name);
  };

  const handleCvcChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 4);
    setCvc(cleaned);
    updateParent(cardNumber, expiry, cleaned, name);
  };

  const handleNameChange = (text: string) => {
    setName(text);
    updateParent(cardNumber, expiry, cvc, text);
  };

  const selectTestCard = (number: string) => {
    const formatted = formatCardNumber(number);
    setCardNumber(formatted);
    setExpiry('12/28');
    setCvc('123');
    setName('Test User');
    setShowTestCards(false);
    Haptics.selectionAsync();
    
    onCardChange({
      number,
      expMonth: '12',
      expYear: '28',
      cvc: '123',
      name: 'Test User',
      isValid: true});
  };

  const cardBrand = getCardBrand(cardNumber);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.testCardsToggle}
        onPress={() => {
          setShowTestCards(!showTestCards);
          Haptics.selectionAsync();
        }}
        disabled={disabled}
      >
        <Text style={styles.testCardsToggleText}>
          {showTestCards ? 'Hide Test Cards' : '🧪 Use Test Card'}
        </Text>
      </TouchableOpacity>

      {showTestCards && (
        <View style={styles.testCardsContainer}>
          {TEST_CARDS.map((card, index) => (
            <TouchableOpacity
              key={index}
              style={styles.testCardButton}
              onPress={() => selectTestCard(card.number)}
            >
              <Text style={styles.testCardLabel}>{card.label}</Text>
              <Text style={styles.testCardNumber}>****{card.number.slice(-4)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.cardNumberContainer}>
        <View style={styles.cardNumberIcon}>
          <CreditCard size={20} color={Colors.textSecondary} />
        </View>
        <TextInput
          style={styles.cardNumberInput}
          value={cardNumber}
          onChangeText={handleCardNumberChange}
          placeholder="1234 5678 9012 3456"
          placeholderTextColor={Colors.textTertiary}
          keyboardType="number-pad"
          maxLength={19}
          editable={!disabled}
        />
        {cardBrand && (
          <View style={styles.cardBrandBadge}>
            <Text style={styles.cardBrandText}>{cardBrand}</Text>
          </View>
        )}
      </View>

      <View style={styles.rowInputs}>
        <View style={[styles.inputContainer, { flex: 1 }]}>
          <Text style={styles.inputLabel}>Expiry</Text>
          <TextInput
            style={styles.input}
            value={expiry}
            onChangeText={handleExpiryChange}
            placeholder="MM/YY"
            placeholderTextColor={Colors.textTertiary}
            keyboardType="number-pad"
            maxLength={5}
            editable={!disabled}
          />
        </View>
        <View style={[styles.inputContainer, { flex: 1 }]}>
          <Text style={styles.inputLabel}>CVC</Text>
          <View style={styles.cvcContainer}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={cvc}
              onChangeText={handleCvcChange}
              placeholder="123"
              placeholderTextColor={Colors.textTertiary}
              keyboardType="number-pad"
              maxLength={4}
              secureTextEntry
              editable={!disabled}
            />
            <Lock size={16} color={Colors.textTertiary} />
          </View>
        </View>
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.inputLabel}>Cardholder Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={handleNameChange}
          placeholder="John Doe"
          placeholderTextColor={Colors.textTertiary}
          autoCapitalize="words"
          editable={!disabled}
        />
      </View>

      {validateCard() && (
        <View style={styles.validIndicator}>
          <Text style={styles.validText}>✓ Card details complete</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12},
  testCardsToggle: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.warning + '15',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.warning + '30'},
  testCardsToggleText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.warning},
  testCardsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8},
  testCardButton: {
    backgroundColor: Colors.backgroundTertiary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  testCardLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.text},
  testCardNumber: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 2},
  cardNumberContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cardNumberIcon: {
    marginRight: 10},
  cardNumberInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: Colors.text,
    letterSpacing: 1},
  cardBrandBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4},
  cardBrandText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.primary},
  rowInputs: {
    flexDirection: 'row',
    gap: 12},
  inputContainer: {
    gap: 6},
  inputLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  input: {
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cvcContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  validIndicator: {
    backgroundColor: Colors.success + '15',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center'},
  validText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.success}});
