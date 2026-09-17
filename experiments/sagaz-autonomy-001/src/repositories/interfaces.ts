import type {
  Farm,
  FarmUnit,
  FlockLot,
  FlockLifecycleEvent,
  EggProduction,
  FeedStock,
} from '../domain/models';

export interface IFarmRepository {
  getById(id: string): Promise<Farm | undefined>;
  getFirst(): Promise<Farm | undefined>;
  save(farm: Farm): Promise<void>;
  update(id: string, updates: Partial<Farm>): Promise<void>;
  delete(id: string): Promise<void>;
  listAll(): Promise<Farm[]>;
}

export interface IFarmUnitRepository {
  getById(id: string): Promise<FarmUnit | undefined>;
  listByFarmId(farmId: string): Promise<FarmUnit[]>;
  save(unit: FarmUnit): Promise<void>;
  update(id: string, updates: Partial<FarmUnit>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IFlockLotRepository {
  getById(id: string): Promise<FlockLot | undefined>;
  listByUnitId(unitId: string): Promise<FlockLot[]>;
  listAll(): Promise<FlockLot[]>;
  save(lot: FlockLot): Promise<void>;
  update(id: string, updates: Partial<FlockLot>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IFlockLifecycleEventRepository {
  getById(id: string): Promise<FlockLifecycleEvent | undefined>;
  listByLotId(flockLotId: string): Promise<FlockLifecycleEvent[]>;
  save(event: FlockLifecycleEvent): Promise<void>;
  listAll(): Promise<FlockLifecycleEvent[]>;
}

export interface IEggProductionRepository {
  listByLotId(lotId: string): Promise<EggProduction[]>;
  listAll(): Promise<EggProduction[]>;
  save(production: EggProduction): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface IFeedStockRepository {
  listByFarmId(farmId: string): Promise<FeedStock[]>;
  save(stock: FeedStock): Promise<void>;
  update(id: string, updates: Partial<FeedStock>): Promise<void>;
}
