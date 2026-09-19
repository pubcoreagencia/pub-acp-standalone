// src/discovery/IDiscoveryProvider.ts

import { DiscoveryScope, DiscoveryProviderResult } from "./DiscoveryContracts";

/**
 * Interface for a read‑only discovery provider.
 * Providers must never perform authorization or mutate the Catalog.
 * They receive the discovery scope and an AbortSignal for cancellation.
 */
export interface IDiscoveryProvider {
  /** Human‑readable name for diagnostics */
  readonly name: string;

  /**
   * Discover raw candidates.
   * @param scope Discovery scope (roots, limits, etc.).
   * @param signal AbortSignal to support cancellation.
   * @returns Promise resolving to a DiscoveryProviderResult containing candidates,
   *          status, and optional diagnostics.
   */
  discover(
    scope: DiscoveryScope,
    signal: AbortSignal
  ): Promise<DiscoveryProviderResult>;
}
