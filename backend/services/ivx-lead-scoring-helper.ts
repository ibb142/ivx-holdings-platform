// File: backend/services/ivx-lead-scoring-helper.ts

// Define the types for SEC filing metadata
interface SECFilingMetadata {
  revenueIncrease: number;
  profitMargin: number;
  marketCap: number;
  liquidityRatio: number;
}

// Enum for Lead Temperature
enum LeadTemperature {
  Hot = 'hot',
  Warm = 'warm',
  Cold = 'cold',
}

// Function to calculate lead temperature
function calculateLeadTemperature(metadata: SECFilingMetadata): LeadTemperature {
  const { revenueIncrease, profitMargin, marketCap, liquidityRatio } = metadata;

  if (revenueIncrease > 20 && profitMargin > 15 && marketCap > 1_000_000_000 && liquidityRatio > 1.5) {
    return LeadTemperature.Hot;
  } else if (revenueIncrease > 10 || profitMargin > 10 || marketCap > 500_000_000 || liquidityRatio > 1.0) {
    return LeadTemperature.Warm;
  } else {
    return LeadTemperature.Cold;
  }
}

export { SECFilingMetadata, LeadTemperature, calculateLeadTemperature };