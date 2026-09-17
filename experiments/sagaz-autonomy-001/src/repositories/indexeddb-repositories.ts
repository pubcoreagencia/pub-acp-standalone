import type {
  IFarmRepository,
  IFarmUnitRepository,
  IFlockLotRepository,
  IFlockLifecycleEventRepository,
  IEggProductionRepository,
  IFeedStockRepository,
} from './interfaces';
import type { Farm, FarmUnit, FlockLot, FlockLifecycleEvent, EggProduction, FeedStock } from '../domain/models';
import { db, SagazDatabase } from '../infrastructure/db/database';

export class IndexedDbFarmRepository implements IFarmRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async getById(id: string): Promise<Farm | undefined> {
    return this.database.farms.get(id);
  }

  async getFirst(): Promise<Farm | undefined> {
    return this.database.farms.toCollection().first();
  }

  async save(farm: Farm): Promise<void> {
    await this.database.farms.put(farm);
  }

  async update(id: string, updates: Partial<Farm>): Promise<void> {
    await this.database.farms.update(id, { ...updates, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.database.farms.delete(id);
  }

  async listAll(): Promise<Farm[]> {
    return this.database.farms.toArray();
  }
}

export class IndexedDbFarmUnitRepository implements IFarmUnitRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async getById(id: string): Promise<FarmUnit | undefined> {
    return this.database.farmUnits.get(id);
  }

  async listByFarmId(farmId: string): Promise<FarmUnit[]> {
    return this.database.farmUnits.where('farmId').equals(farmId).toArray();
  }

  async save(unit: FarmUnit): Promise<void> {
    await this.database.farmUnits.put(unit);
  }

  async update(id: string, updates: Partial<FarmUnit>): Promise<void> {
    await this.database.farmUnits.update(id, { ...updates, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.database.farmUnits.delete(id);
  }
}

export class IndexedDbFlockLotRepository implements IFlockLotRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async getById(id: string): Promise<FlockLot | undefined> {
    return this.database.flockLots.get(id);
  }

  async listByUnitId(unitId: string): Promise<FlockLot[]> {
    return this.database.flockLots.where('farmUnitId').equals(unitId).toArray();
  }

  async listAll(): Promise<FlockLot[]> {
    return this.database.flockLots.toArray();
  }

  async save(lot: FlockLot): Promise<void> {
    await this.database.flockLots.put(lot);
  }

  async update(id: string, updates: Partial<FlockLot>): Promise<void> {
    await this.database.flockLots.update(id, { ...updates, updatedAt: new Date().toISOString() });
  }

  async delete(id: string): Promise<void> {
    await this.database.flockLots.delete(id);
  }
}

export class IndexedDbFlockLifecycleEventRepository implements IFlockLifecycleEventRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async getById(id: string): Promise<FlockLifecycleEvent | undefined> {
    return this.database.flockLifecycleEvents.get(id);
  }

  async listByLotId(flockLotId: string): Promise<FlockLifecycleEvent[]> {
    // Sort descending by date
    const events = await this.database.flockLifecycleEvents.where('flockLotId').equals(flockLotId).toArray();
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }

  async save(event: FlockLifecycleEvent): Promise<void> {
    await this.database.flockLifecycleEvents.put(event);
  }

  async listAll(): Promise<FlockLifecycleEvent[]> {
    const events = await this.database.flockLifecycleEvents.toArray();
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }
}

export class IndexedDbEggProductionRepository implements IEggProductionRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async listByLotId(lotId: string): Promise<EggProduction[]> {
    return this.database.eggProductions.where('flockLotId').equals(lotId).toArray();
  }

  async listAll(): Promise<EggProduction[]> {
    return this.database.eggProductions.toArray();
  }

  async save(production: EggProduction): Promise<void> {
    await this.database.eggProductions.put(production);
  }

  async delete(id: string): Promise<void> {
    await this.database.eggProductions.delete(id);
  }
}

export class IndexedDbFeedStockRepository implements IFeedStockRepository {
  private database: SagazDatabase;

  constructor(database: SagazDatabase = db) {
    this.database = database;
  }

  async listByFarmId(farmId: string): Promise<FeedStock[]> {
    return this.database.feedStocks.where('farmId').equals(farmId).toArray();
  }

  async save(stock: FeedStock): Promise<void> {
    await this.database.feedStocks.put(stock);
  }

  async update(id: string, updates: Partial<FeedStock>): Promise<void> {
    await this.database.feedStocks.update(id, { ...updates, updatedAt: new Date().toISOString() });
  }
}
