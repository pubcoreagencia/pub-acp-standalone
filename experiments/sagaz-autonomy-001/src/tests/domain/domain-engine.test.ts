import { describe, it, expect } from 'vitest';
import {
  calculateCurrentFlock,
  calculateMortalityRate,
  calculateFlockAgeWeeks,
  calculateUsableEggs,
  calculateLayRate,
  calculateEggsPerBird,
  calculateFeedPerBirdGrams,
  calculateFeedCost,
  calculateFeedCostPerEgg,
  calculateFeedConversionPerDozen,
  calculateFeedStockAutonomyDays,
  calculateHatchRate,
  calculateContributionMargin,
  calculateBreakEvenEggs,
  calculateBreakEvenRevenue,
  simulateScale,
  validateFlockQuantities,
  validateMortalityEvent,
  validateDiscardEvent,
  validateTransferEvent,
  validateWeighingEvent,
  validateVaccinationEvent,
  validateStatusChange,
} from '../../domain/engine/index';

describe('SAGAZ Domain Engine — Unit & Zootechnical Tests', () => {
  describe('1. Validação de Integridade do Lote (Flock Integrity)', () => {
    it('approves consistent flock quantities', () => {
      const result = validateFlockQuantities(1000, 985, 15);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('rejects negative initial quantity', () => {
      const result = validateFlockQuantities(-100, 50, 0);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('quantidade inicial não pode ser negativa');
    });

    it('rejects negative mortality', () => {
      const result = validateFlockQuantities(1000, 1000, -5);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('mortalidade acumulada não pode ser negativa');
    });

    it('rejects negative discard', () => {
      const result = validateFlockQuantities(1000, 990, 5, -3);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('descarte acumulado não pode ser negativo');
    });

    it('rejects negative current quantity', () => {
      const result = validateFlockQuantities(1000, -10, 5);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('quantidade atual não pode ser negativa');
    });

    it('rejects current quantity greater than initial', () => {
      const result = validateFlockQuantities(1000, 1050, 0);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('superior à quantidade inicial');
    });

    it('rejects inconsistent state where current + mortality + discard exceeds initial', () => {
      const result = validateFlockQuantities(1000, 980, 20, 10); // 980 + 20 + 10 = 1010 > 1000
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('ultrapassa o alojamento inicial');
    });
  });

  describe('2. Validações de Eventos de Ciclo de Vida (Phase 2)', () => {
    it('validates mortality event: quantity > 0 and quantity <= currentLiveBirds', () => {
      expect(validateMortalityEvent(3, 100).isValid).toBe(true);
      expect(validateMortalityEvent(0, 100).isValid).toBe(false);
      expect(validateMortalityEvent(-1, 100).isValid).toBe(false);
      expect(validateMortalityEvent(1.5, 100).isValid).toBe(false);
      expect(validateMortalityEvent(101, 100).isValid).toBe(false); // Exceeds live birds
    });

    it('validates discard event: quantity > 0 and quantity <= currentLiveBirds', () => {
      expect(validateDiscardEvent(5, 50).isValid).toBe(true);
      expect(validateDiscardEvent(0, 50).isValid).toBe(false);
      expect(validateDiscardEvent(51, 50).isValid).toBe(false);
    });

    it('validates transfer event: valid units, destination different from origin, qty <= live birds', () => {
      expect(validateTransferEvent(100, 500, 'unit-1', 'unit-2').isValid).toBe(true);
      expect(validateTransferEvent(100, 500, 'unit-1', 'unit-1').isValid).toBe(false); // Same unit
      expect(validateTransferEvent(600, 500, 'unit-1', 'unit-2').isValid).toBe(false); // Exceeds flock
      expect(validateTransferEvent(100, 500, 'unit-1', '').isValid).toBe(false); // Empty destination
    });

    it('validates weighing event: positive weight and sample size', () => {
      expect(validateWeighingEvent(1850, 50).isValid).toBe(true);
      expect(validateWeighingEvent(0, 50).isValid).toBe(false);
      expect(validateWeighingEvent(1850, 0).isValid).toBe(false);
      expect(validateWeighingEvent(1850, -5).isValid).toBe(false);
    });

    it('validates vaccination event: non-empty product or protocol', () => {
      expect(validateVaccinationEvent('Newcastle H120').isValid).toBe(true);
      expect(validateVaccinationEvent('').isValid).toBe(false);
      expect(validateVaccinationEvent('   ').isValid).toBe(false);
    });

    it('validates status change: must differ from current and cannot alter culled/sold status', () => {
      expect(validateStatusChange('rearing', 'laying').isValid).toBe(true);
      expect(validateStatusChange('laying', 'laying').isValid).toBe(false);
      expect(validateStatusChange('culled', 'laying').isValid).toBe(false);
      expect(validateStatusChange('sold', 'laying').isValid).toBe(false);
    });
  });

  describe('3. Plantel / Flock Calculations & State Derivation', () => {
    it('calculates normal flock reduction with mortality and culling/discard', () => {
      expect(calculateCurrentFlock(1000, 15, 5)).toBe(980);
      expect(calculateCurrentFlock(1000, 3, 0)).toBe(997);
    });

    it('handles zero mortality and zero culling', () => {
      expect(calculateCurrentFlock(500, 0, 0)).toBe(500);
    });

    it('prevents negative flock size if mortality exceeds initial', () => {
      expect(calculateCurrentFlock(100, 120, 0)).toBe(0);
      expect(calculateCurrentFlock(-50, 0, 0)).toBe(0);
    });

    it('calculates mortality rate correctly', () => {
      expect(calculateMortalityRate(25, 1000)).toBe(2.5);
      expect(calculateMortalityRate(0, 1000)).toBe(0);
    });

    it('safely handles zero initial flock in mortality calculation (no NaN or Infinity)', () => {
      expect(calculateMortalityRate(10, 0)).toBe(0);
      expect(calculateMortalityRate(-5, 100)).toBe(0);
    });

    it('calculates flock age in full elapsed weeks', () => {
      const now = new Date('2026-09-16T00:00:00Z');
      const housed = new Date('2026-08-19T00:00:00Z'); // 28 days = 4 weeks
      expect(calculateFlockAgeWeeks(housed, now)).toBe(4);
      expect(calculateFlockAgeWeeks('2026-10-01', now)).toBe(0);
    });
  });

  describe('4. Produção / Production (Preserves Real Zeros)', () => {
    it('calculates usable eggs excluding broken/discarded', () => {
      expect(calculateUsableEggs(850, 12)).toBe(838);
      expect(calculateUsableEggs(500, 0)).toBe(500);
      expect(calculateUsableEggs(50, 60)).toBe(0);
    });

    it('strictly preserves zero eggs collected as zero usable eggs (no phantom fallback)', () => {
      expect(calculateUsableEggs(0, 0)).toBe(0);
      expect(calculateUsableEggs(0, 10)).toBe(0);
    });

    it('calculates lay rate percentage based on current live birds', () => {
      expect(calculateLayRate(850, 1000)).toBe(85.0);
      expect(calculateLayRate(480, 500)).toBe(96.0);
    });

    it('protects against division by zero in lay rate (zero birds)', () => {
      expect(calculateLayRate(100, 0)).toBe(0);
      expect(calculateLayRate(0, 1000)).toBe(0);
    });

    it('calculates average eggs per bird', () => {
      expect(calculateEggsPerBird(850, 1000)).toBe(0.85);
      expect(calculateEggsPerBird(0, 1000)).toBe(0);
      expect(calculateEggsPerBird(500, 0)).toBe(0);
    });
  });

  describe('5. Alimentação / Feed & Autonomia Real', () => {
    it('calculates daily consumption in grams per bird', () => {
      expect(calculateFeedPerBirdGrams(115, 1000)).toBe(115.0);
    });

    it('protects against zero birds in feed per bird', () => {
      expect(calculateFeedPerBirdGrams(100, 0)).toBe(0);
      expect(calculateFeedPerBirdGrams(0, 1000)).toBe(0);
    });

    it('calculates feed costs and cost per egg', () => {
      const feedCost = calculateFeedCost(100, 2.5);
      expect(feedCost).toBe(250.0);
      expect(calculateFeedCostPerEgg(feedCost, 800)).toBe(0.3125);
    });

    it('protects against zero usable eggs in feed cost per egg', () => {
      expect(calculateFeedCostPerEgg(250, 0)).toBe(0);
    });

    it('calculates feed conversion per dozen eggs', () => {
      expect(calculateFeedConversionPerDozen(100, 600)).toBe(2.0);
    });

    it('calculates realistic feed autonomy in days from stock and live flock', () => {
      expect(calculateFeedStockAutonomyDays(2415, 1000, 115)).toBe(21);
      expect(calculateFeedStockAutonomyDays(575, 1000, 115)).toBe(5);
    });

    it('safely returns 0 days if stock or birds are 0', () => {
      expect(calculateFeedStockAutonomyDays(0, 1000, 115)).toBe(0);
      expect(calculateFeedStockAutonomyDays(2000, 0, 115)).toBe(0);
    });
  });

  describe('6. Reprodução / Hatching', () => {
    it('calculates hatch rate percentage', () => {
      expect(calculateHatchRate(85, 100)).toBe(85.0);
      expect(calculateHatchRate(0, 100)).toBe(0);
    });

    it('protects against zero incubated eggs', () => {
      expect(calculateHatchRate(50, 0)).toBe(0);
    });
  });

  describe('7. Financeiro / Financial & Break-Even', () => {
    it('calculates positive contribution margin', () => {
      expect(calculateContributionMargin(0.80, 0.45)).toBe(0.35);
    });

    it('calculates zero and negative margin appropriately', () => {
      expect(calculateContributionMargin(0.50, 0.50)).toBe(0);
      expect(calculateContributionMargin(0.40, 0.60)).toBe(-0.20);
    });

    it('calculates break-even eggs needed to cover fixed costs', () => {
      expect(calculateBreakEvenEggs(3500, 0.80, 0.45)).toBe(10000);
    });

    it('returns 0 break-even eggs when margin is zero or negative', () => {
      expect(calculateBreakEvenEggs(3500, 0.50, 0.50)).toBe(0);
      expect(calculateBreakEvenEggs(3500, 0.40, 0.60)).toBe(0);
    });

    it('calculates break-even revenue', () => {
      expect(calculateBreakEvenRevenue(3500, 0.80, 0.45)).toBe(8000.0);
      expect(calculateBreakEvenRevenue(3500, 0.40, 0.60)).toBe(0);
    });
  });

  describe('8. Simulação de Escala / Scale Simulation', () => {
    const baseInput = {
      currentFlockSize: 1000,
      percentageGrowth: 20,
      layingRatePercent: 85,
      feedGramsPerBirdDay: 115,
      feedCostPerKg: 2.50,
      salePricePerEgg: 0.80,
      fixedMonthlyCostsPer1000Birds: 1200,
      capexPerNewBird: 50,
    };

    it('calculates +20% scale simulation properly', () => {
      const result = simulateScale(baseInput);
      expect(result.baselineFlockSize).toBe(1000);
      expect(result.additionalBirds).toBe(200);
      expect(result.targetFlockSize).toBe(1200);
      expect(result.projectedDailyEggs).toBe(1020);
      expect(result.projectedMonthlyEggs).toBe(30600);
      expect(result.projectedMonthlyRevenue).toBe(24480);
      expect(result.estimatedExpansionCapex).toBe(10000);
      expect(result.projectedMonthlyNetProfit).toBe(12690);
      expect(result.projectedPaybackMonths).toBe(0.8);
    });

    it('calculates +50% and +100% scale simulation', () => {
      const result50 = simulateScale({ ...baseInput, percentageGrowth: 50 });
      expect(result50.targetFlockSize).toBe(1500);

      const result100 = simulateScale({ ...baseInput, percentageGrowth: 100 });
      expect(result100.targetFlockSize).toBe(2000);
    });

    it('handles negative or invalid growth gracefully', () => {
      const result = simulateScale({ ...baseInput, percentageGrowth: -10 });
      expect(result.additionalBirds).toBe(0);
      expect(result.targetFlockSize).toBe(1000);
    });
  });
});
