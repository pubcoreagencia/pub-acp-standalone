import {
  IndexedDbFarmRepository,
  IndexedDbFarmUnitRepository,
  IndexedDbFlockLotRepository,
  IndexedDbFlockLifecycleEventRepository,
  IndexedDbEggProductionRepository,
  IndexedDbFeedStockRepository,
} from '../../repositories/indexeddb-repositories';
import type { FlockLot, FarmUnit, FlockLifecycleEvent, FlockStatus } from '../../domain/models';
import {
  validateFlockQuantities,
  validateMortalityEvent,
  validateDiscardEvent,
  validateTransferEvent,
  validateWeighingEvent,
  validateVaccinationEvent,
  validateStatusChange,
  calculateFeedStockAutonomyDays,
} from '../../domain/engine';
import { db } from '../../infrastructure/db/database';

export interface RecordMortalityInput {
  flockLotId: string;
  quantity: number;
  date: string;
  reason?: string;
  notes?: string;
}

export interface RecordDiscardInput {
  flockLotId: string;
  quantity: number;
  date: string;
  reason?: string;
  notes?: string;
}

export interface RecordTransferInput {
  flockLotId: string;
  toUnitId: string;
  date: string;
  quantity?: number; // transfer entire lot to unit or partial
  reason?: string;
  notes?: string;
}

export interface RecordVaccinationInput {
  flockLotId: string;
  productOrProtocol: string;
  date: string;
  responsible?: string;
  notes?: string;
}

export interface RecordWeighingInput {
  flockLotId: string;
  averageWeightGrams: number;
  sampleSize: number;
  date: string;
  notes?: string;
}

export interface ChangeFlockStatusInput {
  flockLotId: string;
  newStatus: FlockStatus;
  date: string;
  reason?: string;
  notes?: string;
}

export class FarmApplicationService {
  private farmRepo = new IndexedDbFarmRepository();
  private unitRepo = new IndexedDbFarmUnitRepository();
  private lotRepo = new IndexedDbFlockLotRepository();
  private eventRepo = new IndexedDbFlockLifecycleEventRepository();
  private eggRepo = new IndexedDbEggProductionRepository();
  private feedRepo = new IndexedDbFeedStockRepository();

  async getDashboardSummary() {
    const farm = await this.farmRepo.getFirst();
    const lots = await this.lotRepo.listAll();
    const productions = await this.eggRepo.listAll();
    const feeds = farm ? await this.feedRepo.listByFarmId(farm.id) : [];

    const totalLiveBirds = lots.reduce((acc, lot) => acc + (lot.currentQuantity || 0), 0);
    const totalInitialBirds = lots.reduce((acc, lot) => acc + (lot.initialQuantity || 0), 0);
    const totalMortality = lots.reduce((acc, lot) => acc + (lot.accumulatedMortality || 0), 0);

    const todayDate = new Date().toISOString().split('T')[0];
    const todayProductions = productions.filter((p) => p.date === todayDate);

    const todayEggsCollected = todayProductions.reduce((acc, p) => acc + p.eggsCollected, 0);
    const todayEggsUsable = todayProductions.reduce((acc, p) => acc + p.eggsUsable, 0);

    let effectiveLayRate = 0;
    if (todayEggsCollected > 0 && totalLiveBirds > 0) {
      effectiveLayRate = Number(((todayEggsCollected / totalLiveBirds) * 100).toFixed(1));
    } else if (productions.length > 0 && totalLiveBirds > 0) {
      const latest = productions.sort((a, b) => b.date.localeCompare(a.date))[0];
      effectiveLayRate = latest.layRatePercent;
    }

    const totalFeedStockKg = feeds.reduce((acc, f) => acc + f.currentStockKg, 0);
    const feedAutonomyDays = calculateFeedStockAutonomyDays(totalFeedStockKg, totalLiveBirds, 115);

    return {
      farm,
      totalLots: lots.length,
      totalLiveBirds,
      totalInitialBirds,
      totalMortality,
      effectiveLayRate,
      todayEggsCollected,
      todayEggsUsable,
      totalFeedStockKg,
      feedAutonomyDays,
    };
  }

  async listLotsWithUnits(): Promise<Array<{ lot: FlockLot; unitName: string }>> {
    const lots = await this.lotRepo.listAll();
    const result = [];
    for (const lot of lots) {
      const unit = await this.unitRepo.getById(lot.farmUnitId);
      result.push({
        lot,
        unitName: unit ? unit.name : 'Unidade Desconhecida',
      });
    }
    return result;
  }

  async listUnits(farmId: string): Promise<FarmUnit[]> {
    return this.unitRepo.listByFarmId(farmId);
  }

  async getLotById(id: string): Promise<FlockLot | undefined> {
    return this.lotRepo.getById(id);
  }

  async createFlockLot(data: Omit<FlockLot, 'id' | 'createdAt' | 'updatedAt'>): Promise<FlockLot> {
    const validation = validateFlockQuantities(
      data.initialQuantity,
      data.currentQuantity,
      data.accumulatedMortality,
      data.accumulatedDiscard || 0
    );
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const id = `lot-${Date.now()}`;
    const newLot: FlockLot = {
      ...data,
      id,
      accumulatedDiscard: data.accumulatedDiscard || 0,
      createdAt: now,
      updatedAt: now,
    };

    const housingEvent: FlockLifecycleEvent = {
      id: `evt-housing-${Date.now()}`,
      flockLotId: id,
      type: 'HOUSING',
      date: data.housingDate || now,
      quantity: data.initialQuantity,
      notes: `Alojamento inicial de ${data.initialQuantity} aves da linhagem ${data.breed}.`,
      createdAt: now,
    };

    // Atomic transaction: save lot + housing event
    await db.transaction('rw', [db.flockLots, db.flockLifecycleEvents], async () => {
      await db.flockLots.put(newLot);
      await db.flockLifecycleEvents.put(housingEvent);
    });

    return newLot;
  }

  async updateFlockLot(id: string, updates: Partial<FlockLot>): Promise<void> {
    const existing = await this.lotRepo.getById(id);
    if (!existing) {
      throw new Error(`Lote com id ${id} não encontrado.`);
    }

    const initial = updates.initialQuantity !== undefined ? updates.initialQuantity : existing.initialQuantity;
    const current = updates.currentQuantity !== undefined ? updates.currentQuantity : existing.currentQuantity;
    const mortality = updates.accumulatedMortality !== undefined ? updates.accumulatedMortality : existing.accumulatedMortality;
    const discard = updates.accumulatedDiscard !== undefined ? updates.accumulatedDiscard : (existing.accumulatedDiscard || 0);

    const validation = validateFlockQuantities(initial, current, mortality, discard);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    await this.lotRepo.update(id, updates);
  }

  async deleteFlockLot(id: string): Promise<void> {
    await this.lotRepo.delete(id);
  }

  // --- LIFECYCLE EVENT ACTIONS (PHASE 2) ---

  async listEventsByLotId(flockLotId: string): Promise<FlockLifecycleEvent[]> {
    return this.eventRepo.listByLotId(flockLotId);
  }

  async recordMortality(input: RecordMortalityInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const validation = validateMortalityEvent(input.quantity, lot.currentQuantity);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const eventId = `evt-mort-${Date.now()}`;
    const newCurrent = lot.currentQuantity - input.quantity;
    const newMortality = lot.accumulatedMortality + input.quantity;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'MORTALITY',
      date: input.date || now,
      quantity: input.quantity,
      reason: input.reason,
      notes: input.notes,
      createdAt: now,
    };

    // Atomic transaction: save event + reduce flock current + increment mortality
    await db.transaction('rw', [db.flockLots, db.flockLifecycleEvents], async () => {
      await db.flockLifecycleEvents.put(event);
      await db.flockLots.update(lot.id, {
        currentQuantity: newCurrent,
        accumulatedMortality: newMortality,
        updatedAt: now,
      });
    });

    return event;
  }

  async recordDiscard(input: RecordDiscardInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const validation = validateDiscardEvent(input.quantity, lot.currentQuantity);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const eventId = `evt-disc-${Date.now()}`;
    const newCurrent = lot.currentQuantity - input.quantity;
    const currentDiscard = lot.accumulatedDiscard || 0;
    const newDiscard = currentDiscard + input.quantity;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'DISCARD',
      date: input.date || now,
      quantity: input.quantity,
      reason: input.reason,
      notes: input.notes,
      createdAt: now,
    };

    // Atomic transaction: save discard event + reduce current (does NOT increase mortality)
    await db.transaction('rw', [db.flockLots, db.flockLifecycleEvents], async () => {
      await db.flockLifecycleEvents.put(event);
      await db.flockLots.update(lot.id, {
        currentQuantity: newCurrent,
        accumulatedDiscard: newDiscard,
        updatedAt: now,
      });
    });

    return event;
  }

  async recordTransfer(input: RecordTransferInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const qty = input.quantity || lot.currentQuantity;
    const validation = validateTransferEvent(qty, lot.currentQuantity, lot.farmUnitId, input.toUnitId);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const toUnit = await this.unitRepo.getById(input.toUnitId);
    if (!toUnit) {
      throw new Error('Unidade de destino não encontrada.');
    }

    const now = new Date().toISOString();
    const eventId = `evt-transf-${Date.now()}`;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'TRANSFER',
      date: input.date || now,
      quantity: qty,
      fromUnitId: lot.farmUnitId,
      toUnitId: input.toUnitId,
      reason: input.reason,
      notes: input.notes,
      createdAt: now,
    };

    // Atomic transaction: update lot unit location and record transfer audit
    await db.transaction('rw', [db.flockLots, db.flockLifecycleEvents], async () => {
      await db.flockLifecycleEvents.put(event);
      await db.flockLots.update(lot.id, {
        farmUnitId: input.toUnitId,
        updatedAt: now,
      });
    });

    return event;
  }

  async recordVaccination(input: RecordVaccinationInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const validation = validateVaccinationEvent(input.productOrProtocol);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const eventId = `evt-vax-${Date.now()}`;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'VACCINATION',
      date: input.date || now,
      productOrProtocol: input.productOrProtocol,
      responsible: input.responsible,
      notes: input.notes,
      createdAt: now,
    };

    // Record event without altering bird quantities
    await this.eventRepo.save(event);
    return event;
  }

  async recordWeighing(input: RecordWeighingInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const validation = validateWeighingEvent(input.averageWeightGrams, input.sampleSize);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const eventId = `evt-weigh-${Date.now()}`;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'WEIGHING',
      date: input.date || now,
      averageWeightGrams: input.averageWeightGrams,
      sampleSize: input.sampleSize,
      notes: input.notes,
      createdAt: now,
    };

    // Record event without altering bird quantities
    await this.eventRepo.save(event);
    return event;
  }

  async changeFlockStatus(input: ChangeFlockStatusInput): Promise<FlockLifecycleEvent> {
    const lot = await this.lotRepo.getById(input.flockLotId);
    if (!lot) {
      throw new Error(`Lote ${input.flockLotId} não encontrado.`);
    }

    const validation = validateStatusChange(lot.status, input.newStatus);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    const now = new Date().toISOString();
    const eventId = `evt-status-${Date.now()}`;

    const event: FlockLifecycleEvent = {
      id: eventId,
      flockLotId: lot.id,
      type: 'STATUS_CHANGE',
      date: input.date || now,
      previousStatus: lot.status,
      newStatus: input.newStatus,
      reason: input.reason,
      notes: input.notes,
      createdAt: now,
    };

    // Atomic transaction: update lot status and save status audit event
    await db.transaction('rw', [db.flockLots, db.flockLifecycleEvents], async () => {
      await db.flockLifecycleEvents.put(event);
      await db.flockLots.update(lot.id, {
        status: input.newStatus,
        updatedAt: now,
      });
    });

    return event;
  }
}

export const farmService = new FarmApplicationService();
