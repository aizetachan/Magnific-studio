import type {
  CapabilityMapConfig,
  GenerationKind,
  TransportCapability,
  TransportId,
} from "@/types/generation";
import config from "./capabilityMap.config.json";

/**
 * The CapabilityMap is config-driven (§5.5): when Magnific extends
 * models/endpoints/capabilities they only edit capabilityMap.config.json and
 * routing adapts on its own. The Router never hardcodes transport abilities.
 */
export class CapabilityMap {
  private cfg: CapabilityMapConfig;

  constructor(cfg: CapabilityMapConfig = config as CapabilityMapConfig) {
    this.cfg = cfg;
  }

  get version(): number {
    return this.cfg.version;
  }

  capabilityOf(id: TransportId): TransportCapability {
    return this.cfg.transports[id];
  }

  /** Baseline credit cost for a kind, used by preflight when no live quote. */
  baselineCredits(kind: GenerationKind): number {
    return this.cfg.creditBaseline[kind] ?? 10;
  }

  /** Transports that declare support for a kind, in config order. */
  transportsFor(kind: GenerationKind): TransportId[] {
    return (Object.keys(this.cfg.transports) as TransportId[]).filter((id) =>
      this.cfg.transports[id].kinds.includes(kind),
    );
  }
}
