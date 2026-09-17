/**
 * SAGAZ FARM OS — Pure Domain Engine
 * Deterministic mathematical formulas and state transition logic for poultry management.
 * Guaranteed: No NaN, No Infinity, Explicit boundary handling, Zero division safeguards.
 */

import type { FlockStatus } from '../models';

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates flock quantities to prevent inconsistent states.
 * Enforces:
 * - initialQuantity >= 0
 * - accumulatedMortality >= 0
 * - accumulatedDiscard >= 0
 * - currentQuantity >= 0
 * - currentQuantity <= initialQuantity
 * - currentQuantity + accumulatedMortality + accumulatedDiscard <= initialQuantity (for base lot without external additions)
 */
export function validateFlockQuantities(
  initialQuantity: number,
  currentQuantity: number,
  accumulatedMortality: number,
  accumulatedDiscard: number = 0
): ValidationResult {
  if (initialQuantity < 0) {
    return { isValid: false, error: 'A quantidade inicial não pode ser negativa.' };
  }
  if (accumulatedMortality < 0) {
    return { isValid: false, error: 'A mortalidade acumulada não pode ser negativa.' };
  }
  if (accumulatedDiscard < 0) {
    return { isValid: false, error: 'O descarte acumulado não pode ser negativo.' };
  }
  if (currentQuantity < 0) {
    return { isValid: false, error: 'A quantidade atual não pode ser negativa.' };
  }
  if (currentQuantity > initialQuantity) {
    return { isValid: false, error: 'A quantidade atual não pode ser superior à quantidade inicial alojada.' };
  }
  if (currentQuantity + accumulatedMortality + accumulatedDiscard > initialQuantity) {
    return {
      isValid: false,
      error: `A soma de aves vivas (${currentQuantity}), mortalidade (${accumulatedMortality}) e descartes (${accumulatedDiscard}) ultrapassa o alojamento inicial (${initialQuantity}).`,
    };
  }
  return { isValid: true };
}

/**
 * Validates mortality event inputs against current live flock.
 */
export function validateMortalityEvent(
  quantity: number,
  currentLiveBirds: number
): ValidationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { isValid: false, error: 'A quantidade de mortalidade deve ser um número inteiro maior que zero.' };
  }
  if (quantity > currentLiveBirds) {
    return {
      isValid: false,
      error: `Mortalidade informada (${quantity}) excede o saldo atual de aves vivas no lote (${currentLiveBirds}).`,
    };
  }
  return { isValid: true };
}

/**
 * Validates discard event inputs against current live flock.
 */
export function validateDiscardEvent(
  quantity: number,
  currentLiveBirds: number
): ValidationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { isValid: false, error: 'A quantidade de descarte deve ser um número inteiro maior que zero.' };
  }
  if (quantity > currentLiveBirds) {
    return {
      isValid: false,
      error: `Descarte informado (${quantity}) excede o saldo atual de aves vivas no lote (${currentLiveBirds}).`,
    };
  }
  return { isValid: true };
}

/**
 * Validates transfer event inputs.
 */
export function validateTransferEvent(
  quantity: number,
  currentLiveBirds: number,
  fromUnitId: string,
  toUnitId: string
): ValidationResult {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { isValid: false, error: 'A quantidade a ser transferida deve ser um número inteiro maior que zero.' };
  }
  if (quantity > currentLiveBirds) {
    return {
      isValid: false,
      error: `Quantidade de transferência (${quantity}) excede o saldo de aves do lote (${currentLiveBirds}).`,
    };
  }
  if (!toUnitId || toUnitId.trim() === '') {
    return { isValid: false, error: 'A unidade de destino é obrigatória.' };
  }
  if (fromUnitId === toUnitId) {
    return { isValid: false, error: 'A unidade de destino deve ser diferente da unidade de origem.' };
  }
  return { isValid: true };
}

/**
 * Validates weighing event inputs.
 */
export function validateWeighingEvent(
  averageWeightGrams: number,
  sampleSize: number
): ValidationResult {
  if (averageWeightGrams <= 0) {
    return { isValid: false, error: 'O peso médio amostrado deve ser maior que zero gramas.' };
  }
  if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
    return { isValid: false, error: 'O tamanho da amostra pesada deve ser um número inteiro positivo.' };
  }
  return { isValid: true };
}

/**
 * Validates vaccination event inputs.
 */
export function validateVaccinationEvent(
  productOrProtocol: string
): ValidationResult {
  if (!productOrProtocol || productOrProtocol.trim() === '') {
    return { isValid: false, error: 'O nome da vacina ou protocolo sanitário é obrigatório.' };
  }
  return { isValid: true };
}

/**
 * Validates status change transition.
 */
export function validateStatusChange(
  currentStatus: FlockStatus,
  newStatus: FlockStatus
): ValidationResult {
  if (currentStatus === newStatus) {
    return { isValid: false, error: `O lote já se encontra no status '${currentStatus}'.` };
  }
  if (currentStatus === 'culled' || currentStatus === 'sold') {
    return { isValid: false, error: `Não é permitido alterar o status de um lote já finalizado (${currentStatus}).` };
  }
  return { isValid: true };
}

/**
 * 1. PLANTEL / FLOCK DERIVATION
 */

/**
 * Calculates current live birds in a flock taking into account mortality and discard.
 * Formula: initial - accumulatedMortality - culled - discard
 */
export function calculateCurrentFlock(
  initialQuantity: number,
  accumulatedMortality: number,
  culledOrDiscarded: number = 0
): number {
  if (initialQuantity < 0 || accumulatedMortality < 0 || culledOrDiscarded < 0) return 0;
  const current = initialQuantity - accumulatedMortality - culledOrDiscarded;
  return Math.max(0, current);
}

/**
 * Calculates mortality rate percentage.
 * Formula: (accumulatedMortality / initialQuantity) * 100
 * Denominator: initial housed birds (aves alojadas inicialmente).
 */
export function calculateMortalityRate(
  accumulatedMortality: number,
  initialQuantity: number
): number {
  if (initialQuantity <= 0 || accumulatedMortality <= 0) return 0;
  const rate = (accumulatedMortality / initialQuantity) * 100;
  return Math.min(100, Math.max(0, Number(rate.toFixed(2))));
}

/**
 * Calculates flock age in full elapsed weeks.
 * Returns 0 if housingDate is in the future or invalid.
 */
export function calculateFlockAgeWeeks(
  housingDate: string | Date,
  referenceDate: string | Date = new Date()
): number {
  const start = new Date(housingDate).getTime();
  const end = new Date(referenceDate).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  const diffDays = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(0, Math.floor(diffDays / 7));
}

/**
 * 2. PRODUÇÃO / PRODUCTION
 */

export function calculateUsableEggs(
  eggsCollected: number,
  eggsBrokenOrDiscarded: number
): number {
  if (eggsCollected <= 0) return 0;
  const broken = Math.max(0, eggsBrokenOrDiscarded || 0);
  return Math.max(0, eggsCollected - broken);
}

export function calculateLayRate(
  eggsCollected: number,
  currentLiveBirds: number
): number {
  if (currentLiveBirds <= 0 || eggsCollected <= 0) return 0;
  const rate = (eggsCollected / currentLiveBirds) * 100;
  return Number(rate.toFixed(2));
}

export function calculateEggsPerBird(
  eggsCollected: number,
  currentLiveBirds: number
): number {
  if (currentLiveBirds <= 0 || eggsCollected <= 0) return 0;
  const avg = eggsCollected / currentLiveBirds;
  return Number(avg.toFixed(3));
}

/**
 * 3. ALIMENTAÇÃO / FEED
 */

export function calculateFeedPerBirdGrams(
  totalFeedKg: number,
  currentLiveBirds: number
): number {
  if (currentLiveBirds <= 0 || totalFeedKg <= 0) return 0;
  const grams = (totalFeedKg * 1000) / currentLiveBirds;
  return Number(grams.toFixed(1));
}

export function calculateFeedCost(
  totalFeedKg: number,
  costPerKg: number
): number {
  if (totalFeedKg <= 0 || costPerKg <= 0) return 0;
  return Number((totalFeedKg * costPerKg).toFixed(2));
}

export function calculateFeedCostPerEgg(
  totalFeedCost: number,
  usableEggs: number
): number {
  if (usableEggs <= 0 || totalFeedCost <= 0) return 0;
  const cost = totalFeedCost / usableEggs;
  return Number(cost.toFixed(4));
}

export function calculateFeedConversionPerDozen(
  totalFeedKg: number,
  usableEggs: number
): number {
  if (usableEggs <= 0 || totalFeedKg <= 0) return 0;
  const dozens = usableEggs / 12;
  const ratio = totalFeedKg / dozens;
  return Number(ratio.toFixed(3));
}

export function calculateFeedStockAutonomyDays(
  totalFeedStockKg: number,
  currentLiveBirds: number,
  dailyConsumptionGramsPerBird: number = 115
): number {
  if (totalFeedStockKg <= 0 || currentLiveBirds <= 0 || dailyConsumptionGramsPerBird <= 0) {
    return 0;
  }
  const dailyFlockConsumptionKg = (currentLiveBirds * dailyConsumptionGramsPerBird) / 1000;
  if (dailyFlockConsumptionKg <= 0) return 0;
  return Math.floor(totalFeedStockKg / dailyFlockConsumptionKg);
}

/**
 * 4. REPRODUÇÃO / HATCHING
 */

export function calculateHatchRate(
  hatchedChicks: number,
  incubatedEggs: number
): number {
  if (incubatedEggs <= 0 || hatchedChicks <= 0) return 0;
  const rate = (hatchedChicks / incubatedEggs) * 100;
  return Math.min(100, Math.max(0, Number(rate.toFixed(2))));
}

/**
 * 5. FINANCEIRO / FINANCIAL & BREAK-EVEN
 */

export function calculateContributionMargin(
  salePricePerEgg: number,
  variableCostPerEgg: number
): number {
  if (salePricePerEgg < 0) return 0;
  return Number((salePricePerEgg - Math.max(0, variableCostPerEgg)).toFixed(4));
}

export function calculateBreakEvenEggs(
  fixedCosts: number,
  salePricePerEgg: number,
  variableCostPerEgg: number
): number {
  if (fixedCosts <= 0) return 0;
  const margin = calculateContributionMargin(salePricePerEgg, variableCostPerEgg);
  if (margin <= 0) return 0;
  return Math.ceil(fixedCosts / margin);
}

export function calculateBreakEvenRevenue(
  fixedCosts: number,
  salePricePerEgg: number,
  variableCostPerEgg: number
): number {
  const eggsNeeded = calculateBreakEvenEggs(fixedCosts, salePricePerEgg, variableCostPerEgg);
  if (eggsNeeded <= 0 || salePricePerEgg <= 0) return 0;
  return Number((eggsNeeded * salePricePerEgg).toFixed(2));
}

/**
 * 6. SIMULAÇÃO DE ESCALA / SCALE SIMULATION
 */

export interface ScaleSimulationInput {
  currentFlockSize: number;
  percentageGrowth: number;
  layingRatePercent: number;
  feedGramsPerBirdDay: number;
  feedCostPerKg: number;
  salePricePerEgg: number;
  fixedMonthlyCostsPer1000Birds: number;
  capexPerNewBird: number;
}

export interface ScaleSimulationOutput {
  baselineFlockSize: number;
  targetFlockSize: number;
  additionalBirds: number;
  projectedDailyEggs: number;
  projectedMonthlyEggs: number;
  projectedMonthlyFeedKg: number;
  projectedMonthlyFeedCost: number;
  projectedMonthlyRevenue: number;
  projectedMonthlyTotalCosts: number;
  projectedMonthlyNetProfit: number;
  estimatedExpansionCapex: number;
  projectedPaybackMonths: number;
}

export function simulateScale(input: ScaleSimulationInput): ScaleSimulationOutput {
  const baseline = Math.max(0, input.currentFlockSize);
  const growthFactor = Math.max(0, input.percentageGrowth) / 100;
  const additional = Math.round(baseline * growthFactor);
  const targetFlock = baseline + additional;

  const dailyEggs = Math.round(targetFlock * (Math.max(0, input.layingRatePercent) / 100));
  const monthlyEggs = dailyEggs * 30;

  const dailyFeedKg = (targetFlock * Math.max(0, input.feedGramsPerBirdDay)) / 1000;
  const monthlyFeedKg = Number((dailyFeedKg * 30).toFixed(1));
  const monthlyFeedCost = Number((monthlyFeedKg * Math.max(0, input.feedCostPerKg)).toFixed(2));

  const monthlyRevenue = Number((monthlyEggs * Math.max(0, input.salePricePerEgg)).toFixed(2));
  const monthlyFixedCosts = Number(((targetFlock / 1000) * Math.max(0, input.fixedMonthlyCostsPer1000Birds)).toFixed(2));
  const monthlyTotalCosts = Number((monthlyFeedCost + monthlyFixedCosts).toFixed(2));
  const monthlyNetProfit = Number((monthlyRevenue - monthlyTotalCosts).toFixed(2));

  const capex = Number((additional * Math.max(0, input.capexPerNewBird)).toFixed(2));
  let payback = 0;
  if (capex > 0 && monthlyNetProfit > 0) {
    payback = Number((capex / monthlyNetProfit).toFixed(1));
  }

  return {
    baselineFlockSize: baseline,
    targetFlockSize: targetFlock,
    additionalBirds: additional,
    projectedDailyEggs: dailyEggs,
    projectedMonthlyEggs: monthlyEggs,
    projectedMonthlyFeedKg: monthlyFeedKg,
    projectedMonthlyFeedCost: monthlyFeedCost,
    projectedMonthlyRevenue: monthlyRevenue,
    projectedMonthlyTotalCosts: monthlyTotalCosts,
    projectedMonthlyNetProfit: monthlyNetProfit,
    estimatedExpansionCapex: capex,
    projectedPaybackMonths: payback,
  };
}
