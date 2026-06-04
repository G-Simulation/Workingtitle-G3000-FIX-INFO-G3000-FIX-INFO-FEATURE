import { EventBus, IcaoValue } from '@microsoft/msfs-sdk';

import {
  FixDefinition,
  FIXINFO_EVENT_TOPIC_INSERTED,
  FIXINFO_EVENT_TOPIC_REMOVED,
  FixInfoEvents,
} from '../shared/FixTypes';

export interface CachedFixBearings {
  radial1Mag: number;
  radial2Mag?: number;
  /** Magnetic variation at the Place — required for BasicNavAngleSubject.set(value, magVar). */
  place1MagVar: number;
}

function placeKey(icao: IcaoValue): string {
  return `${icao.region}|${icao.airport}|${icao.ident}|${icao.type}`;
}

/**
 * GTC-side cache mapping a Place ICAO → its most recently used FIX radials.
 * Populated from FIXINFO_EVENT_TOPIC_INSERTED events. Used by the
 * FixInfoUserWaypointDialog: when the user selects a REF that already has
 * a FIX on it in the current session, RAD1 (and RAD2 if present) are
 * pre-populated so multi-fix groups don't need to re-enter the bearings.
 *
 * Only RAD_DIS and RAD_RAD modes contribute. RAD_DIS's optional radial2Mag is
 * captured. Cache survives only within a single flight (UserFacilities don't
 * persist across sim restarts in MSFS), so no restore-from-FacilityRepository
 * logic is needed.
 */
export class FixDefinitionCache {
  private static _instance: FixDefinitionCache | null = null;

  public static get instance(): FixDefinitionCache | null {
    return FixDefinitionCache._instance;
  }

  public static init(bus: EventBus): FixDefinitionCache {
    if (FixDefinitionCache._instance === null) {
      FixDefinitionCache._instance = new FixDefinitionCache(bus);
    }
    return FixDefinitionCache._instance;
  }

  private readonly byPlace = new Map<string, CachedFixBearings>();

  private constructor(bus: EventBus) {
    const sub = bus.getSubscriber<FixInfoEvents>();
    sub.on(FIXINFO_EVENT_TOPIC_INSERTED).handle((def) => this.onInserted(def));
    sub.on(FIXINFO_EVENT_TOPIC_REMOVED).handle(() => { /* see note in class doc */ });
  }

  private onInserted(def: FixDefinition): void {
    if (def.mode === 'RAD_DIS') {
      this.byPlace.set(placeKey(def.place1Icao), {
        radial1Mag: def.radial1Mag,
        radial2Mag: def.radial2Mag,
        place1MagVar: def.place1MagVar,
      });
    } else if (def.mode === 'RAD_RAD') {
      this.byPlace.set(placeKey(def.place1Icao), {
        radial1Mag: def.radial1Mag,
        radial2Mag: def.radial2Mag,
        place1MagVar: def.place1MagVar,
      });
    }
  }

  public lookup(icao: IcaoValue): CachedFixBearings | undefined {
    return this.byPlace.get(placeKey(icao));
  }
}
