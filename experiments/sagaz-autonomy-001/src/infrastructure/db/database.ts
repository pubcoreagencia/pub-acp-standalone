import Dexie, { type Table } from 'dexie';
import type {
  Farm,
  FarmUnit,
  FlockLot,
  FlockLifecycleEvent,
  EggProduction,
  FeedStock,
  FeedConsumption,
  HatchCycle,
  Sale,
  Revenue,
  Expense,
  Alert,
  ScaleSimulation,
  SagazModel,
} from '../../domain/models';

export class SagazDatabase extends Dexie {
  farms!: Table<Farm, string>;
  farmUnits!: Table<FarmUnit, string>;
  flockLots!: Table<FlockLot, string>;
  flockLifecycleEvents!: Table<FlockLifecycleEvent, string>;
  eggProductions!: Table<EggProduction, string>;
  feedStocks!: Table<FeedStock, string>;
  feedConsumptions!: Table<FeedConsumption, string>;
  hatchCycles!: Table<HatchCycle, string>;
  sales!: Table<Sale, string>;
  revenues!: Table<Revenue, string>;
  expenses!: Table<Expense, string>;
  alerts!: Table<Alert, string>;
  scaleSimulations!: Table<ScaleSimulation, string>;
  sagazModels!: Table<SagazModel, string>;

  constructor(databaseName: string = 'SagazFarmOS_DB') {
    super(databaseName);

    this.version(1).stores({
      farms: 'id, name, createdAt',
      farmUnits: 'id, farmId, name, status',
      flockLots: 'id, farmUnitId, code, breed, status, housingDate',
      flockLifecycleEvents: 'id, flockLotId, type, date',
      eggProductions: 'id, flockLotId, date',
      feedStocks: 'id, farmId, name',
      feedConsumptions: 'id, flockLotId, feedStockId, date',
      hatchCycles: 'id, farmId, code, status, startDate',
      sales: 'id, farmId, date, status',
      revenues: 'id, farmId, date, category',
      expenses: 'id, farmId, date, category, type',
      alerts: 'id, farmId, severity, resolved, createdAt',
      scaleSimulations: 'id, farmId, name, createdAt',
      sagazModels: 'id',
    });
  }
}

export const db = new SagazDatabase();
