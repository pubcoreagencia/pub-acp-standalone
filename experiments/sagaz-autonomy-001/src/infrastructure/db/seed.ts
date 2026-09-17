import { db } from './database';
import type { Farm, FarmUnit, FlockLot, FeedStock, EggProduction, FlockLifecycleEvent } from '../../domain/models';

export async function isDatabaseInitialized(): Promise<boolean> {
  const farmCount = await db.farms.count();
  return farmCount > 0;
}

export async function seedInitialFarmData(): Promise<void> {
  const initialized = await isDatabaseInitialized();
  if (initialized) return;

  const now = new Date().toISOString();

  // 1. Fazenda Principal SAGAZ
  const farmId = 'farm-sagaz-matriz';
  const farm: Farm = {
    id: farmId,
    name: 'Fazenda SAGAZ — Piloto Agroecológico',
    ownerName: 'Matheus Paes',
    location: 'Circuito das Águas — SP',
    totalAreaHectares: 12.5,
    createdAt: now,
    updatedAt: now,
  };

  // 2. Unidades Físicas (Aviários & Piquetes)
  const unit1Id = 'unit-aviario-01';
  const unit2Id = 'unit-aviario-02';
  const units: FarmUnit[] = [
    {
      id: unit1Id,
      farmId,
      name: 'Galpão 1 — Poedeiras Coloniais',
      type: 'aviary',
      capacityBirds: 1500,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: unit2Id,
      farmId,
      name: 'Galpão 2 — Recria & Postura',
      type: 'pasture',
      capacityBirds: 1000,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ];

  // 3. Lotes de Plantel
  const lotAId = 'lot-isabrown-01';
  const lotBId = 'lot-embrapa-02';
  const lots: FlockLot[] = [
    {
      id: lotAId,
      farmUnitId: unit1Id,
      code: 'LOTE-ISA-2026-01',
      breed: 'Isa Brown',
      housingDate: new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString(),
      initialQuantity: 1000,
      currentQuantity: 985,
      accumulatedMortality: 15,
      accumulatedDiscard: 0,
      status: 'laying',
      acquisitionCostPerBird: 38.5,
      notes: 'Lote matriz em produção contínua, excelente conversão.',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: lotBId,
      farmUnitId: unit2Id,
      code: 'LOTE-EMB-2026-02',
      breed: 'Embrapa 051',
      housingDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      initialQuantity: 500,
      currentQuantity: 496,
      accumulatedMortality: 4,
      accumulatedDiscard: 0,
      status: 'rearing',
      acquisitionCostPerBird: 35.0,
      notes: 'Lote rústico adaptado a piquete agroecológico.',
      createdAt: now,
      updatedAt: now,
    },
  ];

  // 4. Histórico Real de Eventos de Ciclo de Vida (Phase 2 Traceability Seed)
  const events: FlockLifecycleEvent[] = [
    // Lote A
    {
      id: 'evt-seed-housing-lotA',
      flockLotId: lotAId,
      type: 'HOUSING',
      date: new Date(Date.now() - 42 * 24 * 60 * 60 * 1000).toISOString(),
      quantity: 1000,
      notes: 'Alojamento inicial de 1000 frangas poedeiras Isa Brown.',
      createdAt: now,
    },
    {
      id: 'evt-seed-vax-lotA',
      flockLotId: lotAId,
      type: 'VACCINATION',
      date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString(),
      productOrProtocol: 'Newcastle + Bronquite Infecciosa (H120)',
      responsible: 'Dr. Roberto Veterinário',
      notes: 'Vacinação em água de bebida conforme protocolo sanitário da granja.',
      createdAt: now,
    },
    {
      id: 'evt-seed-weigh-lotA',
      flockLotId: lotAId,
      type: 'WEIGHING',
      date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      averageWeightGrams: 1820,
      sampleSize: 50,
      notes: 'Amostragem de 50 aves no Galpão 1. Uniformidade de lote 88%.',
      createdAt: now,
    },
    {
      id: 'evt-seed-status-lotA',
      flockLotId: lotAId,
      type: 'STATUS_CHANGE',
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      previousStatus: 'rearing',
      newStatus: 'laying',
      reason: 'Início de postura comercial aos 80% de produtividade.',
      createdAt: now,
    },
    {
      id: 'evt-seed-mort-lotA',
      flockLotId: lotAId,
      type: 'MORTALITY',
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      quantity: 15,
      reason: 'Causas naturais acumuladas no período de transição térmica.',
      notes: 'Mortalidade acumulada dentro dos parâmetros zootécnicos esperados.',
      createdAt: now,
    },
    // Lote B
    {
      id: 'evt-seed-housing-lotB',
      flockLotId: lotBId,
      type: 'HOUSING',
      date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      quantity: 500,
      notes: 'Alojamento inicial de 500 pintainhas caipiras Embrapa 051.',
      createdAt: now,
    },
    {
      id: 'evt-seed-vax-lotB',
      flockLotId: lotBId,
      type: 'VACCINATION',
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      productOrProtocol: 'Gumboro Cevec',
      responsible: 'Equipe de Manejo',
      notes: 'Primeira dose administrada.',
      createdAt: now,
    },
    {
      id: 'evt-seed-mort-lotB',
      flockLotId: lotBId,
      type: 'MORTALITY',
      date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      quantity: 4,
      reason: 'Seleção inicial pós-alojamento.',
      createdAt: now,
    },
  ];

  // 5. Estoque Inicial de Ração
  const feedStock: FeedStock = {
    id: 'feed-stock-postura-01',
    farmId,
    name: 'Ração Balanceada Postura 18% PB',
    supplier: 'NutriCampo Agroindustrial',
    currentStockKg: 2450,
    minimumStockKg: 500,
    costPerKg: 2.65,
    lastRestockDate: now,
    createdAt: now,
    updatedAt: now,
  };

  // 6. Histórico Inicial de Produção Diária
  const productions: EggProduction[] = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const collected = 860 - i * 5;
    const broken = 8;
    const usable = collected - broken;
    const rate = Number(((collected / 985) * 100).toFixed(2));

    productions.push({
      id: `prod-loteA-${d}`,
      flockLotId: lotAId,
      date: d,
      eggsCollected: collected,
      eggsBrokenOrDiscarded: broken,
      eggsUsable: usable,
      layRatePercent: rate,
      collectorName: 'Operador Geral',
      createdAt: now,
    });
  }

  // Gravação transacional no banco
  await db.transaction(
    'rw',
    [db.farms, db.farmUnits, db.flockLots, db.flockLifecycleEvents, db.feedStocks, db.eggProductions],
    async () => {
      await db.farms.put(farm);
      for (const unit of units) await db.farmUnits.put(unit);
      for (const lot of lots) await db.flockLots.put(lot);
      for (const evt of events) await db.flockLifecycleEvents.put(evt);
      await db.feedStocks.put(feedStock);
      for (const prod of productions) await db.eggProductions.put(prod);
    }
  );
}
