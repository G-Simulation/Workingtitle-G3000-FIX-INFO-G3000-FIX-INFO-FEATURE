import {
  EventBus,
  FacilityLoader,
  FacilityRepository,
  FacilityRepositoryEvents,
  FacilitySearchType,
  FacilityType,
  IcaoValue,
  ICAO,
  RunwayUtils,
  UserFacility,
  UserFacilityType,
} from '@microsoft/msfs-sdk';

import {
  FixDefinition,
  FIXINFO_EVENT_TOPIC_INSERTED,
  FIXINFO_EVENT_TOPIC_REMOVED,
  FixInfoEvents,
} from '../shared/FixTypes';

export interface ResolvedFix {
  definition: FixDefinition;
  /** Place facilities resolved from their ICAOs — array length 0/1/2 depending on mode. */
  places: { icao: IcaoValue; lat: number; lon: number }[];
}

export type { FixDefinition };

export type FixStoreListener = (fixes: ReadonlyMap<string, ResolvedFix>) => void;

/**
 * Holds the set of active FIX INFO fixes (keyed by ident) plus resolved place lat/lon
 * needed to draw bearing lines on the map. Asynchronously resolves place facilities
 * via FacilityLoader on insert; updates listeners when resolution completes.
 */
export class FixDefinitionStore {
  private readonly fixes = new Map<string, ResolvedFix>();
  private readonly listeners = new Set<FixStoreListener>();

  constructor(private readonly bus: EventBus, private readonly facLoader: FacilityLoader) {
    const sub = this.bus.getSubscriber<FixInfoEvents>();
    sub.on(FIXINFO_EVENT_TOPIC_INSERTED).handle((def) => { void this.onInserted(def); });
    sub.on(FIXINFO_EVENT_TOPIC_REMOVED).handle((evt) => { this.onRemoved(evt.ident); });

    const repoSub = this.bus.getSubscriber<FacilityRepositoryEvents>();

    // Auto-cleanup: if the underlying UserFacility is removed via the WT-native
    // User Waypoint page, drop our overlay entry too. Then reconcile to clear
    // any other in-memory entries that aren't in the repository anymore.
    repoSub.on('facility_removed').handle((fac) => {
      const ident = fac.icaoStruct?.ident;
      if (typeof ident === 'string' && ident.startsWith('FIX')) {
        console.log('[FixInfo] facility_removed for', ident);
        this.onRemoved(ident);
      }
      this.reconcileWithRepository();
      this.fire();
    });

    // Live-restore on facility_added / facility_changed — NO reconcile here.
    // The cross-context sync between GTC and MFD repos can lag, and reconciling
    // against the MFD repo right after add would drop in-memory fixes that the
    // MFD repo hasn't received yet. Reconciliation only happens on
    // `facility_removed` (an explicit signal that something disappeared).
    const handleRepoEvent = (source: string) => (fac: { icaoStruct?: { ident?: string } }): void => {
      const ident = fac.icaoStruct?.ident;
      if (typeof ident !== 'string') {
        console.log(`[FixInfo] ${source} ignored — no icaoStruct.ident`);
        return;
      }
      if (!ident.startsWith('FIX')) return;
      const uf = fac as UserFacility;
      console.log(`[FixInfo] ${source} for ${ident}: isTemporary=${uf.isTemporary}, userFacilityType=${uf.userFacilityType}, ref1IcaoStruct=${uf.reference1IcaoStruct ? 'yes' : 'no'}, ref1Radial=${uf.reference1Radial}, ref1Distance=${uf.reference1Distance}`);
      if (uf.isTemporary === true) {
        console.log(`[FixInfo] ${source} ${ident} skipped — isTemporary=true`);
        return;
      }
      if (this.fixes.has(ident)) {
        console.log(`[FixInfo] ${source} ${ident} skipped — already in this.fixes`);
        return;
      }
      const def = userFacilityToFixDefinition(uf);
      if (def === null) {
        console.log(`[FixInfo] ${source} ${ident} skipped — userFacilityToFixDefinition returned null`);
        return;
      }
      console.log(`[FixInfo] ${source} → restoring overlay for ${ident}`);
      void this.onInserted(def);
    };

    repoSub.on('facility_added').handle(handleRepoEvent('facility_added'));
    repoSub.on('facility_changed').handle(handleRepoEvent('facility_changed'));

    // Cross-context sync (DumpRequest → DumpResponse) is async. The MFD-repo is
    // typically empty when `onInit()` runs. Retry restore a few times to catch
    // late-arriving syncs in case the facility_added/changed events don't fire
    // for repository-internal reasons.
    const tryRestore = (attempt: number): void => {
      this.restoreFromRepository();
      if (this.fixes.size === 0 && attempt < 5) {
        setTimeout(() => tryRestore(attempt + 1), 500);
      } else if (attempt > 0) {
        console.log(`[FixInfo] tryRestore settled after ${attempt} retries — fixes.size=${this.fixes.size}`);
      }
    };
    tryRestore(0);
  }

  private restoreFromRepository(): void {
    try {
      const repo = FacilityRepository.getRepository(this.bus);
      let restored = 0;
      let scanned = 0;
      let skippedNonFix = 0;
      let skippedTemporary = 0;
      let skippedAlreadyHave = 0;
      let skippedNullDef = 0;
      repo.forEach((fac) => {
        scanned++;
        const ident = fac.icaoStruct?.ident;
        if (typeof ident !== 'string' || !ident.startsWith('FIX')) {
          skippedNonFix++;
          return;
        }
        const uf = fac as UserFacility;
        console.log(`[FixInfo] restore scan ${ident}: isTemporary=${uf.isTemporary}, userFacilityType=${uf.userFacilityType}, ref1IcaoStruct=${uf.reference1IcaoStruct ? 'yes' : 'no'}, ref1Radial=${uf.reference1Radial}, ref1Distance=${uf.reference1Distance}`);
        if (uf.isTemporary === true) {
          skippedTemporary++;
          return;
        }
        if (this.fixes.has(ident)) {
          skippedAlreadyHave++;
          return;
        }
        const def = userFacilityToFixDefinition(uf);
        if (def === null) {
          skippedNullDef++;
          return;
        }
        void this.onInserted(def);
        restored++;
      }, [FacilityType.USR]);
      console.log(`[FixInfo] restoreFromRepository: scanned=${scanned} USR, restored=${restored} FIX*, skippedNonFix=${skippedNonFix}, skippedTemporary=${skippedTemporary}, skippedAlreadyHave=${skippedAlreadyHave}, skippedNullDef=${skippedNullDef}`);
    } catch (err) {
      console.warn('[FixInfo] restoreFromRepository failed', err);
    }
  }

  public addListener(l: FixStoreListener): () => void {
    this.listeners.add(l);
    l(this.fixes);
    return () => { this.listeners.delete(l); };
  }

  public get snapshot(): ReadonlyMap<string, ResolvedFix> { return this.fixes; }

  private async onInserted(def: FixDefinition): Promise<void> {
    // Preliminary entry with empty places — visible immediately
    this.fixes.set(def.ident, { definition: def, places: [] });
    this.fire();

    const places: { icao: IcaoValue; lat: number; lon: number }[] = [];
    if (def.mode === 'RAD_DIS' || def.mode === 'RAD_RAD') {
      const p1 = await this.tryResolveFacility(def.place1Icao);
      if (p1) places.push({ icao: def.place1Icao, lat: p1.lat, lon: p1.lon });
    }
    if (def.mode === 'RAD_RAD') {
      const p2 = await this.tryResolveFacility(def.place2Icao);
      if (p2) places.push({ icao: def.place2Icao, lat: p2.lat, lon: p2.lon });
    }
    this.fixes.set(def.ident, { definition: def, places });
    this.fire();
  }

  private onRemoved(ident: string): void {
    if (this.fixes.delete(ident)) this.fire();
  }

  private async tryResolveFacility(icao: IcaoValue): Promise<{ lat: number; lon: number } | null> {
    try {
      const type = ICAO.getFacilityTypeFromValue(icao);
      if (type === FacilityType.VIS) return null;
      if (type === FacilityType.RWY) {
        // Runway: facLoader may not resolve RWY-ICAOs directly. Look up the
        // parent airport, find the matching OneWayRunway, and use its threshold.
        return await this.resolveRunwayLocation(icao);
      }
      const fac = await this.facLoader.getFacility(type, icao);
      return { lat: fac.lat, lon: fac.lon };
    } catch (err) {
      console.warn('[FixInfo] place facility resolve failed', icao, err);
      return null;
    }
  }

  private async resolveRunwayLocation(rwyIcao: IcaoValue): Promise<{ lat: number; lon: number } | null> {
    const airportIdent = rwyIcao.airport;
    const rawIdent = rwyIcao.ident ?? '';
    const runwayDesignation = rawIdent.startsWith('RW') ? rawIdent.substring(2) : rawIdent;
    if (!airportIdent || !runwayDesignation) return null;
    const matches = await this.facLoader.searchByIdentWithIcaoStructs(FacilitySearchType.Airport, airportIdent, 1);
    if (matches.length === 0) return null;
    const airport = await this.facLoader.getFacility(FacilityType.Airport, matches[0]);
    const runways = RunwayUtils.getOneWayRunwaysFromAirport(airport);
    const runway = runways.find((r) => r.designation === runwayDesignation);
    if (runway === undefined) return null;
    return { lat: runway.latitude, lon: runway.longitude };
  }

  /**
   * Reconciles `this.fixes` against the FacilityRepository: any entry that no
   * longer corresponds to a visible (`isTemporary === false`) FIX-prefixed
   * UserFacility is dropped. This is the source-of-truth check — what the
   * WT user waypoint list shows is what we render, period.
   */
  private reconcileWithRepository(): void {
    if (this.fixes.size === 0) return;
    let repo: ReturnType<typeof FacilityRepository.getRepository>;
    try {
      repo = FacilityRepository.getRepository(this.bus);
    } catch {
      return;
    }
    const visibleIdents = new Set<string>();
    repo.forEach((fac) => {
      const ident = fac.icaoStruct?.ident;
      if (typeof ident !== 'string' || !ident.startsWith('FIX')) return;
      if ((fac as UserFacility).isTemporary === true) return;
      visibleIdents.add(ident);
    }, [FacilityType.USR]);
    for (const ident of [...this.fixes.keys()]) {
      if (!visibleIdents.has(ident)) {
        console.log('[FixInfo] reconcile: dropping', ident, '(not in user waypoint list)');
        this.fixes.delete(ident);
      }
    }
  }

  private fire(): void {
    for (const l of this.listeners) {
      try { l(this.fixes); } catch (err) { console.error('[FixInfo] store listener threw', err); }
    }
  }
}

/** Rebuilds a FixDefinition from a persisted UserFacility's metadata.
 *  RAD2 isn't a dedicated UserFacility field for RAD_DIS mode, so we
 *  recover it from the WT-persisted comment which our dialog formats
 *  as "RAD1°/RAD2°/DIS NM" (see computeFixComment in the dialog). */
function parseRad2FromComment(uf: UserFacility): number | undefined {
  const comment = (uf as { comment?: string }).comment;
  if (typeof comment !== 'string') return undefined;
  // Three-segment form is the only one carrying a RAD2: "270°/090°/25NM".
  const m = comment.trim().match(/^(\d{1,3})°\/(\d{1,3})°\/(\d{1,3})NM$/);
  if (!m) return undefined;
  const rad2 = parseInt(m[2], 10);
  return Number.isFinite(rad2) ? rad2 : undefined;
}

function userFacilityToFixDefinition(uf: UserFacility): FixDefinition | null {
  const base = {
    ident: uf.icaoStruct.ident,
    resultLat: uf.lat,
    resultLon: uf.lon,
    insertedAt: Date.now(),
  };
  switch (uf.userFacilityType) {
    case UserFacilityType.RADIAL_DISTANCE:
      if (!uf.reference1IcaoStruct) return null;
      return {
        mode: 'RAD_DIS', ...base,
        place1Icao: uf.reference1IcaoStruct,
        place1MagVar: uf.reference1MagVar ?? 0,
        radial1Mag: uf.reference1Radial ?? 0,
        distanceNm: uf.reference1Distance ?? 0,
        radial2Mag: parseRad2FromComment(uf),
      };
    case UserFacilityType.RADIAL_RADIAL:
      if (!uf.reference1IcaoStruct || !uf.reference2IcaoStruct) return null;
      return {
        mode: 'RAD_RAD', ...base,
        place1Icao: uf.reference1IcaoStruct,
        place1MagVar: uf.reference1MagVar ?? 0,
        radial1Mag: uf.reference1Radial ?? 0,
        place2Icao: uf.reference2IcaoStruct,
        place2MagVar: uf.reference2MagVar ?? 0,
        radial2Mag: uf.reference2Radial ?? 0,
      };
    case UserFacilityType.LAT_LONG:
      return { mode: 'LAT_LON', ...base };
    default: return null;
  }
}
