/**
 * SAGAZ FARM OS — Core Domain Models
 * Pure interfaces defining the agricultural, poultry, and financial domain.
 */

export interface Farm {
  id: string;
  name: string;
  ownerName: string;
  location: string;
  totalAreaHectares?: number;
  createdAt: string;
  updatedAt: string;
}

export interface FarmUnit {
  id: string;
  farmId: string;
  name: string; // e.g. "Aviário 1", "Piquete Norte"
  type: 'aviary' | 'pasture' | 'brooder' | 'quarantine';
  capacityBirds: number;
  status: 'active' | 'maintenance' | 'empty';
  createdAt: string;
  updatedAt: string;
}

export type FlockStatus =
  | 'growth'
  | 'laying'
  | 'reproduction'
  | 'low_productivity'
  | 'discard'
  | 'sold'
  | 'brooding'
  | 'rearing'
  | 'culled';

export interface FlockLot {
  id: string;
  farmUnitId: string;
  code: string; // e.g. "LOTE-2026-01"
  breed: string; // e.g. "Embrapa 051", "Isa Brown", "GLK"
  housingDate: string; // ISO date
  initialQuantity: number;
  currentQuantity: number;
  accumulatedMortality: number;
  accumulatedDiscard?: number;
  status: FlockStatus;
  acquisitionCostPerBird: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type LifecycleEventType =
  | 'HOUSING'
  | 'MORTALITY'
  | 'DISCARD'
  | 'TRANSFER'
  | 'VACCINATION'
  | 'WEIGHING'
  | 'STATUS_CHANGE';

export interface FlockLifecycleEvent {
  id: string;
  flockLotId: string;
  type: LifecycleEventType;
  date: string; // ISO datetime or YYYY-MM-DD
  quantity?: number; // for MORTALITY, DISCARD, TRANSFER, HOUSING
  fromUnitId?: string; // for TRANSFER
  toUnitId?: string; // for TRANSFER
  previousStatus?: FlockStatus; // for STATUS_CHANGE
  newStatus?: FlockStatus; // for STATUS_CHANGE
  productOrProtocol?: string; // for VACCINATION
  responsible?: string; // for VACCINATION
  averageWeightGrams?: number; // for WEIGHING
  sampleSize?: number; // for WEIGHING
  reason?: string;
  notes?: string;
  createdAt: string;
}

export interface EggProduction {
  id: string;
  flockLotId: string;
  date: string; // YYYY-MM-DD
  eggsCollected: number;
  eggsBrokenOrDiscarded: number;
  eggsUsable: number;
  layRatePercent: number; // calculated at entry
  collectorName?: string;
  notes?: string;
  createdAt: string;
}

export interface FeedStock {
  id: string;
  farmId: string;
  name: string; // e.g. "Ração Postura Fase 1 - Milho e Soja"
  supplier: string;
  currentStockKg: number;
  minimumStockKg: number;
  costPerKg: number;
  lastRestockDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedConsumption {
  id: string;
  flockLotId: string;
  feedStockId: string;
  date: string; // YYYY-MM-DD
  quantityKg: number;
  costTotal: number;
  createdAt: string;
}

export interface HatchCycle {
  id: string;
  farmId: string;
  code: string;
  startDate: string;
  incubatedEggs: number;
  projectedHatchDate: string;
  actualHatched?: number;
  hatchRatePercent?: number;
  status: 'incubating' | 'completed' | 'failed';
  notes?: string;
  createdAt: string;
}

export interface Sale {
  id: string;
  farmId: string;
  customerName: string;
  date: string;
  productType: 'table_eggs' | 'fertile_eggs' | 'culled_birds' | 'manure';
  quantity: number; // unit or dozens depending on type
  unitPrice: number;
  totalAmount: number;
  status: 'pending' | 'completed' | 'cancelled';
  createdAt: string;
}

export interface Revenue {
  id: string;
  farmId: string;
  saleId?: string;
  category: 'egg_sales' | 'bird_sales' | 'derivatives' | 'other';
  amount: number;
  date: string;
  description: string;
  createdAt: string;
}

export interface Expense {
  id: string;
  farmId: string;
  category: 'feed' | 'labor' | 'energy' | 'packaging' | 'veterinary' | 'depreciation' | 'maintenance' | 'other';
  type: 'fixed' | 'variable';
  amount: number;
  date: string;
  description: string;
  createdAt: string;
}

export interface Alert {
  id: string;
  farmId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  category: 'mortality' | 'production' | 'feed' | 'finance';
  resolved: boolean;
  createdAt: string;
}

export interface ScaleSimulation {
  id: string;
  farmId: string;
  name: string;
  baselineFlockSize: number;
  targetFlockSize: number;
  percentageGrowth: number;
  projectedDailyEggs: number;
  projectedMonthlyFeedKg: number;
  projectedMonthlyRevenue: number;
  projectedMonthlyExpense: number;
  projectedNetMargin: number;
  estimatedExpansionCost: number;
  paybackMonths: number;
  createdAt: string;
}

export interface SagazModel {
  id: string;
  initialInvestment: number;
  nominalFlockCapacity: number;
  expectedLayingRatePercent: number;
  feedGramsPerBirdDay: number;
  feedKgCost: number;
  salePricePerEgg: number;
  fixedMonthlyCosts: number;
  projectedPaybackMonths: number;
  projectedMonthlyProfit: number;
  breakEvenEggsPerMonth: number;
}
