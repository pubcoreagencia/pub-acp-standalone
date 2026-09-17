import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { SagazDatabase } from '../../infrastructure/db/database';
import {
  IndexedDbFarmRepository,
  IndexedDbFarmUnitRepository,
  IndexedDbFlockLotRepository,
  IndexedDbFlockLifecycleEventRepository,
} from '../../repositories/indexeddb-repositories';

import type { Farm, FarmUnit, FlockLot } from '../../domain/models';

describe('SAGAZ Real Persistence Layer & Phase 2 Lifecycle Transactions', () => {
  let testDb: SagazDatabase;
  let farmRepo: IndexedDbFarmRepository;
  let unitRepo: IndexedDbFarmUnitRepository;
  let lotRepo: IndexedDbFlockLotRepository;
  let eventRepo: IndexedDbFlockLifecycleEventRepository;

  beforeEach(async () => {
    const dbName = `TestDB_${Math.random().toString(36).substring(7)}`;
    testDb = new SagazDatabase(dbName);
    farmRepo = new IndexedDbFarmRepository(testDb);
    unitRepo = new IndexedDbFarmUnitRepository(testDb);
    lotRepo = new IndexedDbFlockLotRepository(testDb);
    eventRepo = new IndexedDbFlockLifecycleEventRepository(testDb);
  });

  it('performs full CRUD lifecycle on Farm entity and verifies persistence', async () => {
    const farm: Farm = {
      id: 'farm-001',
      name: 'Granja Esperança',
      ownerName: 'Produtor Rural',
      location: 'Interior de SP',
      totalAreaHectares: 8.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await farmRepo.save(farm);
    const retrieved = await farmRepo.getById('farm-001');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Granja Esperança');

    await farmRepo.update('farm-001', { name: 'Granja Esperança — Expandida' });
    const updated = await farmRepo.getById('farm-001');
    expect(updated?.name).toBe('Granja Esperança — Expandida');

    await farmRepo.delete('farm-001');
    const deleted = await farmRepo.getById('farm-001');
    expect(deleted).toBeUndefined();
  });

  it('performs MANDATORY TEST-PERSISTENCE-001 lifecycle with simulated reload/restart', async () => {
    const unit: FarmUnit = {
      id: 'unit-teste-001',
      farmId: 'farm-001',
      name: 'Galpão de Teste',
      type: 'aviary',
      capacityBirds: 500,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await unitRepo.save(unit);

    const testLot: FlockLot = {
      id: 'TEST-PERSISTENCE-001',
      farmUnitId: 'unit-teste-001',
      code: 'TEST-PERSISTENCE-001',
      breed: 'Embrapa 051',
      housingDate: '2026-09-01T00:00:00Z',
      initialQuantity: 250,
      currentQuantity: 248,
      accumulatedMortality: 2,
      status: 'laying',
      acquisitionCostPerBird: 40.0,
      notes: 'Lote de teste de persistência real',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await lotRepo.save(testLot);

    testDb.close();
    const reopenedDb = new SagazDatabase(testDb.name);
    const reloadedLotRepo = new IndexedDbFlockLotRepository(reopenedDb);

    const reloadedLot = await reloadedLotRepo.getById('TEST-PERSISTENCE-001');
    expect(reloadedLot).toBeDefined();
    expect(reloadedLot?.id).toBe('TEST-PERSISTENCE-001');
    expect(reloadedLot?.currentQuantity).toBe(248);

    await reloadedLotRepo.update('TEST-PERSISTENCE-001', { currentQuantity: 247, accumulatedMortality: 3 });
    const modifiedLot = await reloadedLotRepo.getById('TEST-PERSISTENCE-001');
    expect(modifiedLot?.currentQuantity).toBe(247);
    expect(modifiedLot?.accumulatedMortality).toBe(3);

    await reloadedLotRepo.delete('TEST-PERSISTENCE-001');

    reopenedDb.close();
    const finalDb = new SagazDatabase(testDb.name);
    const finalLotRepo = new IndexedDbFlockLotRepository(finalDb);

    const nonExistent = await finalLotRepo.getById('TEST-PERSISTENCE-001');
    expect(nonExistent).toBeUndefined();
    finalDb.close();
  });

  it('executes atomic lifecycle events, updating flock balance and preserving audit history', async () => {
    // 1. Setup Unit & Lot
    const unit1: FarmUnit = {
      id: 'unit-a1',
      farmId: 'farm-matriz',
      name: 'Galpão 1',
      type: 'aviary',
      capacityBirds: 1000,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const unit2: FarmUnit = {
      id: 'unit-a2',
      farmId: 'farm-matriz',
      name: 'Galpão 2',
      type: 'aviary',
      capacityBirds: 1000,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await unitRepo.save(unit1);
    await unitRepo.save(unit2);

    const lot: FlockLot = {
      id: 'lot-lifecycle-01',
      farmUnitId: 'unit-a1',
      code: 'LOTE-TEST-LIFE',
      breed: 'Isa Brown',
      housingDate: '2026-08-01T00:00:00Z',
      initialQuantity: 1000,
      currentQuantity: 1000,
      accumulatedMortality: 0,
      accumulatedDiscard: 0,
      status: 'growth',
      acquisitionCostPerBird: 35.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await lotRepo.save(lot);

    // 2. Record MORTALITY (3 birds)
    await testDb.transaction('rw', [testDb.flockLots, testDb.flockLifecycleEvents], async () => {
      await testDb.flockLifecycleEvents.put({
        id: 'evt-m1',
        flockLotId: 'lot-lifecycle-01',
        type: 'MORTALITY',
        date: new Date().toISOString(),
        quantity: 3,
        reason: 'Parada cardíaca',
        createdAt: new Date().toISOString(),
      });
      await testDb.flockLots.update('lot-lifecycle-01', {
        currentQuantity: 997,
        accumulatedMortality: 3,
      });
    });

    let currentLot = await lotRepo.getById('lot-lifecycle-01');
    expect(currentLot?.currentQuantity).toBe(997);
    expect(currentLot?.accumulatedMortality).toBe(3);

    // 3. Record DISCARD (5 birds) -> reduces flock to 992 without changing mortality
    await testDb.transaction('rw', [testDb.flockLots, testDb.flockLifecycleEvents], async () => {
      await testDb.flockLifecycleEvents.put({
        id: 'evt-d1',
        flockLotId: 'lot-lifecycle-01',
        type: 'DISCARD',
        date: new Date().toISOString(),
        quantity: 5,
        reason: 'Problema locomotor',
        createdAt: new Date().toISOString(),
      });
      await testDb.flockLots.update('lot-lifecycle-01', {
        currentQuantity: 992,
        accumulatedDiscard: 5,
      });
    });

    currentLot = await lotRepo.getById('lot-lifecycle-01');
    expect(currentLot?.currentQuantity).toBe(992);
    expect(currentLot?.accumulatedMortality).toBe(3); // Unchanged!
    expect(currentLot?.accumulatedDiscard).toBe(5);

    // 4. Record VACCINATION & WEIGHING -> leaves flock quantities intact
    await eventRepo.save({
      id: 'evt-v1',
      flockLotId: 'lot-lifecycle-01',
      type: 'VACCINATION',
      date: new Date().toISOString(),
      productOrProtocol: 'Bio-Coccidiose',
      responsible: 'Veterinário Técnico',
      createdAt: new Date().toISOString(),
    });

    await eventRepo.save({
      id: 'evt-w1',
      flockLotId: 'lot-lifecycle-01',
      type: 'WEIGHING',
      date: new Date().toISOString(),
      averageWeightGrams: 1780,
      sampleSize: 30,
      createdAt: new Date().toISOString(),
    });

    currentLot = await lotRepo.getById('lot-lifecycle-01');
    expect(currentLot?.currentQuantity).toBe(992);

    // 5. Record STATUS_CHANGE (growth -> laying)
    await testDb.transaction('rw', [testDb.flockLots, testDb.flockLifecycleEvents], async () => {
      await testDb.flockLifecycleEvents.put({
        id: 'evt-s1',
        flockLotId: 'lot-lifecycle-01',
        type: 'STATUS_CHANGE',
        date: new Date().toISOString(),
        previousStatus: 'growth',
        newStatus: 'laying',
        reason: 'Atingiu 5% de postura',
        createdAt: new Date().toISOString(),
      });
      await testDb.flockLots.update('lot-lifecycle-01', {
        status: 'laying',
      });
    });

    currentLot = await lotRepo.getById('lot-lifecycle-01');
    expect(currentLot?.status).toBe('laying');

    // 6. Record TRANSFER from unit-a1 to unit-a2
    await testDb.transaction('rw', [testDb.flockLots, testDb.flockLifecycleEvents], async () => {
      await testDb.flockLifecycleEvents.put({
        id: 'evt-t1',
        flockLotId: 'lot-lifecycle-01',
        type: 'TRANSFER',
        date: new Date().toISOString(),
        quantity: 992,
        fromUnitId: 'unit-a1',
        toUnitId: 'unit-a2',
        reason: 'Transferência para galpão climatizado',
        createdAt: new Date().toISOString(),
      });
      await testDb.flockLots.update('lot-lifecycle-01', {
        farmUnitId: 'unit-a2',
      });
    });

    currentLot = await lotRepo.getById('lot-lifecycle-01');
    expect(currentLot?.farmUnitId).toBe('unit-a2');

    // 7. Verify all 5 events persisted and queryable chronologically
    const history = await eventRepo.listByLotId('lot-lifecycle-01');
    expect(history.length).toBe(6);
    const eventTypes = history.map((e) => e.type);
    expect(eventTypes).toContain('MORTALITY');
    expect(eventTypes).toContain('DISCARD');
    expect(eventTypes).toContain('VACCINATION');
    expect(eventTypes).toContain('WEIGHING');
    expect(eventTypes).toContain('STATUS_CHANGE');
    expect(eventTypes).toContain('TRANSFER');
  });
});
