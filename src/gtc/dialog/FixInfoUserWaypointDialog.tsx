import {
  AirportFacility,
  Facility,
  FacilitySearchType,
  FacilityType,
  FSComponent,
  ICAO,
  IcaoType,
  IcaoValue,
  MagVar,
  OneWayRunway,
  RunwayFacility,
  RunwayUtils,
  SetSubject,
  Subject,
  UnitType,
  UserFacility,
  UserFacilityType,
  VNode,
} from '@microsoft/msfs-sdk';
import {
  BearingDisplay,
  LatLonDisplay,
  LatLonDisplayFormat,
  NumberUnitDisplay,
} from '@microsoft/msfs-garminsdk';
import { G3000FacilityUtils, G3000FilePaths } from '@microsoft/msfs-wtg3000-common';
import {
  GtcListSelectTouchButton,
  GtcTextDialog,
  GtcToggleTouchButton,
  GtcTouchButton,
  GtcUserWaypointDialog,
  GtcUserWaypointDialogProps,
  GtcValueTouchButton,
  GtcViewKeys,
} from '@microsoft/msfs-wtg3000-gtc';

import {
  FixDefinition,
  FIXINFO_EVENT_TOPIC_INSERTED,
  FIXINFO_EVENT_TOPIC_REMOVED,
  FixInfoEvents,
} from '../../shared/FixTypes';
import { FixDefinitionCache } from '../FixDefinitionCache';
import { fixModeState } from '../insertEnrouteFix';
import { pendingRef1State } from './FixInfoWaypointOptionsSlideoutMenu';

// WT GtcUserWaypointType enum values — referenced as plain strings since the enum
// itself is not exported from the npm package.
const TYPE_RAD_DIS = 'RAD / DIS';
const TYPE_RAD_RAD = 'RAD / RAD';
const TYPE_LAT_LON = 'LAT / LON';
const TYPE_PPOS = 'P.POS';

const FIX_IDENT_PREFIX = 'FIX';

/**
 * Snapshot of the last successfully-saved FIX input, used to pre-fill the dialog
 * on the next open. Reset on plugin reload. Captures store values verbatim (the
 * underlying objects are immutable enough — refs are Facilities, radials are
 * NavAngleUnitFamily values etc.) so a simple `store.X.set(snapshot.X)` restores
 * the previous state.
 */
const lastFixInput: {
  type: string | null;
  ref1: unknown;
  ref2: unknown;
  rad1: unknown;
  rad2: unknown;
  dis1: unknown;
  latLon: unknown;
} = {
  type: null,
  ref1: null,
  ref2: null,
  rad1: null,
  rad2: null,
  dis1: null,
  latLon: null,
};

function ensureFixInfoCss(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('fix-info-css')) return;
  const target = document.head ?? document.body ?? document.documentElement;
  if (!target) return;
  const style = document.createElement('style');
  style.id = 'fix-info-css';
  // Use very-high-specificity selectors (multiple classes) and !important so we
  // beat whatever WT's own stylesheet sets.
  style.textContent = [
    '.fix-info-hidden { display: none !important; }',
    'div.usr-wpt-dialog-params-rad-dis.usr-wpt-dialog-params-type {',
    '  display: flex !important;',
    '  flex-direction: row !important;',
    '  flex-wrap: wrap !important;',
    '  column-gap: 14px !important;',
    '  row-gap: 8px !important;',
    '  justify-content: space-between !important;',
    '  align-items: stretch !important;',
    '}',
    'div.usr-wpt-dialog-params-rad-dis.usr-wpt-dialog-params-type > * {',
    '  flex: 1 1 0 !important;',
    '  min-width: 80px !important;',
    '  margin: 0 4px !important;',
    '}',
  ].join('\n');
  target.appendChild(style);
}

// Internal-member shape — declared so we can access the parent's "private" fields
// without TypeScript yelling. JS has no actual privacy enforcement at runtime.
interface DialogInternals {
  store: {
    ident: Subject<string>;
    isTemporary: Subject<boolean>;
    type: Subject<string>;
    ref1: Subject<any>;
    rad1: Subject<any>;
    dis1: Subject<any>;
    ref2: Subject<any>;
    rad2: Subject<any>;
    latLon: Subject<any>;
    comment: Subject<string>;
    facRepo: { get: (icao: unknown) => unknown };
    setAutoIdent: () => void;
  };
  rootCssClass: { sub: (cb: (s: Set<string>) => void) => void };
  unitsSettingManager: {
    navAngleUnits: any;
    distanceUnitsLarge: any;
  };
  selectIdent: () => Promise<void>;
  selectReference: (subject: any) => Promise<void>;
  selectRadial: (reference: any, subject: any) => Promise<void>;
  selectDistance: (subject: any) => Promise<void>;
  selectLatLon: (subject: any) => Promise<void>;
  selectComment: () => Promise<void>;
}

// Borrow the parent's static formatters (private but readable at runtime).
const PARENT_STATIC = GtcUserWaypointDialog as unknown as {
  REFERENCE_FORMATTER: (reference: any) => string;
  DISTANCE_FORMATTER: (distance: number) => string;
  BEARING_FORMATTER: any;
};

/**
 * Subclass of GtcUserWaypointDialog. Inherits store, lifecycle, request() etc.
 * Overrides only render() to add a "FIX" toggle next to the Temporary toggle,
 * and wraps the store's setAutoIdent at construction time so the auto-generated
 * ident uses a FIX### prefix whenever the FIX toggle is on.
 *
 * Registered via the plugin's onComponentCreating hook so the framework uses
 * this subclass everywhere the WT-native dialog would have been instantiated.
 */
export class FixInfoUserWaypointDialog extends GtcUserWaypointDialog {
  /** User-facing FIX/USR mode toggle. */
  private readonly isFix = Subject.create<boolean>(fixModeState.on);

  /** Class set for the RAD2 button — toggles a hidden class based on isFix. */
  private readonly rad2Classes = SetSubject.create([
    'usr-wpt-dialog-rad-button',
    'fix-info-rad2',
    ...(fixModeState.on ? [] : ['fix-info-hidden']),
  ]);

  public constructor(props: GtcUserWaypointDialogProps) {
    super(props);
    ensureFixInfoCss();

    const internals = this as unknown as DialogInternals;
    const store = internals.store;
    const isFix = this.isFix;

    // Wrap cleanupRequest so whenever the dialog resolves with a successful
    // UserFacility AND FIX mode is on, we publish the overlay event. This
    // catches BOTH our Insert-FIX-button flow AND the WT-native flow.
    const selfAny = this as unknown as {
      cleanupRequest: () => void;
      resultObject: { wasCancelled: boolean; payload: UserFacility | null };
    };
    const origCleanup = selfAny.cleanupRequest.bind(this);
    selfAny.cleanupRequest = (): void => {
      try {
        const r = selfAny.resultObject;
        if (r && !r.wasCancelled && r.payload && isFix.get()) {
          // Promote the preview UserFacility from temporary to permanent
          // ONLY on successful save. Keeping isTemporary=true during the
          // dialog lets WT's preview-cleanup remove the entry on cancel.
          (r.payload as { isTemporary: boolean }).isTemporary = false;
          // Snapshot store values for restoration on next open (only on save).
          lastFixInput.type = store.type.get();
          lastFixInput.ref1 = store.ref1.get();
          lastFixInput.ref2 = store.ref2.get();
          lastFixInput.rad1 = store.rad1.get();
          lastFixInput.rad2 = store.rad2.get();
          lastFixInput.dis1 = store.dis1.get();
          lastFixInput.latLon = store.latLon.get();
          const rad2 = store.rad2?.get?.()?.number;
          // If this was an edit and the ident changed, publish a removal of the
          // old-ident overlay so we don't end up with both old and new on screen.
          const newIdent = r.payload.icaoStruct?.ident;
          if (this.editingSourceIdent && this.editingSourceIdent !== newIdent) {
            publishRemove(props, this.editingSourceIdent);
          }
          publishFixEvent(props, r.payload, rad2);
        }
      } catch (err) {
        console.error('[FixInfo] publish on cleanup failed', err);
      }
      this.editingSourceIdent = null;
      origCleanup();
    };

    // Step 1: wrap setAutoIdent. The original is kept for the USR path.
    const origSetAutoIdent = store.setAutoIdent.bind(store);
    store.setAutoIdent = function (): void {
      if (!isFix.get()) {
        origSetAutoIdent();
        return;
      }
      for (let i = 0; i < 1000; i++) {
        const ident = `${FIX_IDENT_PREFIX}${i.toString().padStart(3, '0')}`;
        const icao = ICAO.value(IcaoType.User, '', G3000FacilityUtils.USER_FACILITY_SCOPE, ident);
        if (store.facRepo.get(icao) === undefined) {
          store.ident.set(ident);
          return;
        }
      }
      store.ident.set('');
    };

    // Auto-populate the Comment with "RAD1°/RAD2°/DIS NM" (mode-dependent) whenever
    // the user changes radial/distance/type — but only while FIX-toggle is ON.
    const updateComment = (): void => {
      if (!this.isFix.get()) return;
      const next = computeFixComment(
        store.type.get(),
        store.rad1.get(),
        store.rad2.get(),
        store.dis1.get(),
      );
      if (store.comment.get() !== next) {
        store.comment.set(next);
      }
    };
    store.type.sub(updateComment);
    store.rad1.sub(updateComment);
    store.rad2.sub(updateComment);
    store.dis1.sub(updateComment);

    // Auto-populate RAD1 (and RAD2 if available) when the user selects a REF1
    // that already has a FIX on it in the current session. Source-of-truth is
    // the GTC-side FixDefinitionCache, populated from FIXINFO_EVENT_TOPIC_INSERTED.
    store.ref1.sub((ref: unknown) => {
      if (!this.isFix.get()) return;
      if (ref === null || typeof ref !== 'object') return;
      const icaoStruct = (ref as { icaoStruct?: IcaoValue }).icaoStruct;
      if (!icaoStruct) return;
      type AnySet = { set: (value: number) => void };

      // Priority 1: if a previous FIX has already been built on this REF in this
      // session, reuse its bearings (so multi-fix groups all share the same lines).
      const cache = FixDefinitionCache.instance;
      const hit = cache?.lookup(icaoStruct);
      if (hit !== undefined) {
        console.log('[FixInfo] auto-populating bearings from cache for REF', icaoStruct.ident, '→ RAD1=', hit.radial1Mag, 'RAD2=', hit.radial2Mag);
        type LocAwareSet = { set: (value: number, lat: number, lon: number) => void };
        const refLat = (ref as { lat?: number }).lat;
        const refLon = (ref as { lon?: number }).lon;
        setTimeout(() => {
          if (typeof refLat === 'number' && typeof refLon === 'number') {
            (store.rad1 as unknown as LocAwareSet).set(hit.radial1Mag, refLat, refLon);
            if (typeof hit.radial2Mag === 'number' && Number.isFinite(hit.radial2Mag)) {
              (store.rad2 as unknown as LocAwareSet).set(hit.radial2Mag, refLat, refLon);
            }
          } else {
            (store.rad1 as unknown as AnySet).set(hit.radial1Mag);
            if (typeof hit.radial2Mag === 'number' && Number.isFinite(hit.radial2Mag)) {
              (store.rad2 as unknown as AnySet).set(hit.radial2Mag);
            }
          }
        }, 0);
        return;
      }

      // Runway REFs (icaoStruct.type === 'R'): auto-fill RAD1/RAD2 from the
      // threshold course. Works regardless of how the runway got into ref1
      // (text-input path AND pendingRef1State path from the flight-plan slideout).
      if (icaoStruct.type === 'R') {
        void this.autoFillRunwayBearings(ref as RunwayFacility);
      }
    });

    // Step 2: now attach the subscription. When the user toggles FIX, sync the
    // module flag AND re-run setAutoIdent so the visible ident updates immediately
    // — but only if the current ident is still an auto-generated USR###/FIX###;
    // never overwrite a custom name the user already typed.
    this.isFix.sub((v) => {
      fixModeState.on = v;
      const current = store.ident.get();
      if (/^(USR|FIX)\d{3}$/.test(current) || current.length === 0) {
        store.setAutoIdent();
      }
      // Show/hide the RAD2 button via class toggle.
      this.rad2Classes.toggle('fix-info-hidden', !v);
      // When the user manually activates FIX (direct-entry path), restore the
      // last-input snapshot once. Suppressed for flight-plan and edit contexts
      // (request() clears the flag in those cases).
      if (v && this.restoreSnapshotOnFixActivation && lastFixInput.type !== null) {
        this.restoreSnapshotOnFixActivation = false;
        const s = store;
        if (lastFixInput.type !== null) s.type.set(lastFixInput.type);
        if (lastFixInput.ref1 !== null) s.ref1.set(lastFixInput.ref1);
        if (lastFixInput.ref2 !== null) s.ref2.set(lastFixInput.ref2);
        if (lastFixInput.rad1 !== null) s.rad1.set(lastFixInput.rad1);
        if (lastFixInput.rad2 !== null) s.rad2.set(lastFixInput.rad2);
        if (lastFixInput.dis1 !== null) s.dis1.set(lastFixInput.dis1);
        if (lastFixInput.latLon !== null) s.latLon.set(lastFixInput.latLon);
        console.log('[FixInfo] restored last-input snapshot on manual FIX activation');
      }
      // NOTE: isTemporary stays at WT's default (true) during the dialog so
      // a cancel can clean up the preview entry. Promotion to permanent
      // happens in cleanupRequest on successful save (above).
      // Refresh comment with current radial/distance values whenever FIX-toggle changes.
      updateComment();
    });

    console.log('[FixInfo] FixInfoUserWaypointDialog ready (FIX toggle + setAutoIdent override)');
  }

  /** When the dialog is re-opened, sync isFix from the module flag and capture
   *  the source-ident if this is an edit so we can clean up its overlay if the
   *  edit changed the ident (otherwise the old entry would linger as a ghost). */
  private editingSourceIdent: string | null = null;
  /** Set by request() — if true, the next FIX-activation will restore the
   *  last-input snapshot. Cleared after a single restore, and suppressed for
   *  flight-plan and edit contexts. */
  private restoreSnapshotOnFixActivation = false;
  public override request(input: any): Promise<any> {
    this.editingSourceIdent = null;
    const editing = (input as { editFacility?: unknown }).editFacility as unknown;
    if (editing) {
      if (typeof editing === 'object' && editing !== null) {
        const ic = (editing as { icaoStruct?: { ident?: string }; ident?: string });
        this.editingSourceIdent = ic.icaoStruct?.ident ?? ic.ident ?? null;
      } else if (typeof editing === 'string') {
        // ICAO V1 string — ident is positions 7-12 trimmed
        this.editingSourceIdent = editing.substring(7, 12).trim() || null;
      }
    }
    // FIX mode auto-activates ONLY when:
    //   - coming from flight-plan context (pendingRef1State.facility set), OR
    //   - editing an existing FIX-prefixed waypoint.
    // Direct "Create User Waypoint" entry starts with FIX off; the user toggles
    // it on manually if desired.
    const pendingFromFlightPlan = pendingRef1State.facility !== null;
    const isEditingFix = !!this.editingSourceIdent && /^FIX\d{3}$/.test(this.editingSourceIdent);
    this.isFix.set(pendingFromFlightPlan || isEditingFix);
    // Consume handoff from FixInfoWaypointOptionsSlideoutMenu (FIX button on
    // a flight-plan leg): pre-fill REF1 with the leg's facility. In that case
    // the leg's context wins — skip the last-input snapshot restoration.
    // Otherwise (regular new-fix creation) restore the last-saved values.
    const pendingRef = pendingRef1State.facility;
    const internals = this as unknown as DialogInternals;
    // Snapshot restoration only fires on direct-entry "Create User Waypoint":
    //   - editing existing waypoint → use the waypoint's data (no restore)
    //   - flight-plan context (pendingRef set) → use the leg's data (no restore)
    //   - direct entry → arm the restore; fires when user manually toggles FIX on
    this.restoreSnapshotOnFixActivation = !editing && pendingRef === null;
    if (pendingRef !== null) {
      pendingRef1State.facility = null;
      setTimeout(() => {
        try {
          internals.store.ref1.set(pendingRef);
          console.log('[FixInfo] dialog request: pre-filled REF1 with', pendingRef.icaoStruct?.ident);
        } catch (err) {
          console.error('[FixInfo] failed to pre-fill REF1 from pending', err);
        }
      }, 0);
    }
    return super.request(input);
  }

  /**
   * Auto-fills RAD1/RAD2 for a runway-typed REF. Uses BasicNavAngleSubject's
   * (value, lat, lon) overload so the rad's internal magvar matches the
   * threshold — without that, BearingDisplay renders the wrong number (the
   * Comment renders raw `.number` correctly, masking the issue).
   */
  private async autoFillRunwayBearings(rwyRef: RunwayFacility): Promise<void> {
    const ic = rwyRef.icaoStruct;
    if (!ic) return;
    const cache = FixDefinitionCache.instance;
    if (cache?.lookup(ic) !== undefined) return; // session cache wins
    const airportIdent = ic.airport;
    if (!airportIdent) return;
    const designation = ic.ident.replace(/^RW/, '');
    const resolved = await this.resolveRunwayFacility(airportIdent, designation);
    if (resolved === null) return;
    const fLat = resolved.facility.lat;
    const fLon = resolved.facility.lon;
    const rad1Mag = ((MagVar.trueToMagnetic(resolved.course, fLat, fLon) % 360) + 360) % 360;
    const rad2Mag = (rad1Mag + 180) % 360;
    const internals = this as unknown as DialogInternals;
    const r1 = internals.store.rad1 as unknown as { set: (v: number, lat: number, lon: number) => void };
    const r2 = internals.store.rad2 as unknown as { set: (v: number, lat: number, lon: number) => void };
    setTimeout(() => {
      r1.set(rad1Mag, fLat, fLon);
      r2.set(rad2Mag, fLat, fLon);
      console.log(`[FixInfo] runway auto-fill via ref1.sub → RAD1=${rad1Mag.toFixed(1)} RAD2=${rad2Mag.toFixed(1)}`);
    }, 0);
  }

  /**
   * FIX-mode REF picker: opens a text-input dialog instead of WT's default
   * waypoint picker. Accepts:
   *   - Standard ident ("EDDS", "FRA", "BIBOS") → searches Airport/VOR/NDB/Intersection
   *   - Runway pattern ("EDDS07", "EDDH23L") → loads the airport and resolves to its OneWayRunway
   *
   * Falls back to standard search if the runway pattern doesn't match a known runway.
   */
  private async selectReferenceForFix(subject: unknown): Promise<void> {
    const sub = subject as { set: (v: Facility) => void };
    try {
      const popup = this.props.gtcService.openPopup<GtcTextDialog>(GtcViewKeys.TextDialog);
      const result = await popup.ref.request({
        label: 'REF / RWY',
        allowSpaces: false,
        maxLength: 7,
        initialValue: '',
      });
      if (result.wasCancelled) return;
      const text = (result.payload ?? '').toString().toUpperCase().trim();
      if (text.length === 0) return;

      // Runway pattern: 4-letter airport + 1-2 digits + optional L/C/R
      const rwyMatch = text.match(/^([A-Z]{4})(\d{1,2})([LCR]?)$/);
      if (rwyMatch !== null) {
        const airportIdent = rwyMatch[1];
        const designation = rwyMatch[2].padStart(2, '0') + rwyMatch[3];
        const resolved = await this.resolveRunwayFacility(airportIdent, designation);
        if (resolved !== null) {
          sub.set(resolved.facility);
          // Convert true→magnetic using the point magvar at the threshold position
          // (the same convention WT uses when storing reference1MagVar). Using
          // airport.magvar instead would cause a 0.5–2° drift relative to the
          // bearing lines drawn by BearingOverlayCanvas.
          const fLat = resolved.facility.lat;
          const fLon = resolved.facility.lon;
          const rad1Mag = ((MagVar.trueToMagnetic(resolved.course, fLat, fLon) % 360) + 360) % 360;
          const rad2Mag = (rad1Mag + 180) % 360;
          console.log(`[FixInfo] REF set to runway ${airportIdent}/${designation} (true=${resolved.course.toFixed(2)}, mag@thr=${rad1Mag.toFixed(2)})`);
          // Auto-fill RAD1/RAD2 unless a previous FIX on this REF is already
          // in the session cache (then ref1.sub will fill from cache instead).
          // Use the (value, lat, lon) overload of BasicNavAngleSubject.set so
          // the rad's internal magvar matches the threshold — without that,
          // BearingDisplay would render the wrong number for rad2.
          const cache = FixDefinitionCache.instance;
          if (cache?.lookup(resolved.facility.icaoStruct) === undefined) {
            type LocAwareSet = { set: (value: number, lat: number, lon: number) => void };
            const store = (this as unknown as DialogInternals).store;
            setTimeout(() => {
              (store.rad1 as unknown as LocAwareSet).set(rad1Mag, fLat, fLon);
              (store.rad2 as unknown as LocAwareSet).set(rad2Mag, fLat, fLon);
              console.log(`[FixInfo] auto-filled bearings → RAD1=${rad1Mag.toFixed(1)} RAD2=${rad2Mag.toFixed(1)}`);
            }, 0);
          }
          return;
        }
        console.warn(`[FixInfo] Runway ${airportIdent}${designation} not found`);
        return;
      }

      // Standard ident search across Airport/VOR/NDB/Intersection
      const facility = await this.resolveFacilityByIdent(text);
      if (facility !== null) {
        sub.set(facility);
        console.log(`[FixInfo] REF set to ${text} (${ICAO.tryValueToStringV2(facility.icaoStruct)})`);
      } else {
        console.warn(`[FixInfo] No facility found for ident ${text}`);
      }
    } catch (err) {
      console.error('[FixInfo] selectReferenceForFix failed', err);
    }
  }

  private async resolveRunwayFacility(
    airportIdent: string,
    designation: string,
  ): Promise<{ facility: RunwayFacility; course: number; magvar: number } | null> {
    const icaos = await this.props.facLoader.searchByIdentWithIcaoStructs(FacilitySearchType.Airport, airportIdent, 1);
    if (icaos.length === 0) return null;
    const airport = await this.props.facLoader.getFacility(FacilityType.Airport, icaos[0]) as AirportFacility;
    const runways: OneWayRunway[] = RunwayUtils.getOneWayRunwaysFromAirport(airport);
    const runway = runways.find((r) => r.designation === designation);
    if (runway === undefined) return null;
    return {
      facility: RunwayUtils.createRunwayFacility(airport, runway),
      course: runway.course,
      magvar: airport.magvar,
    };
  }

  private async resolveFacilityByIdent(ident: string): Promise<Facility | null> {
    const icaos = await this.props.facLoader.searchByIdentWithIcaoStructs(FacilitySearchType.AllExceptVisual, ident, 1);
    if (icaos.length === 0) return null;
    const icao = icaos[0];
    const type = ICAO.getFacilityTypeFromValue(icao);
    return this.props.facLoader.getFacility(type, icao) as Promise<Facility>;
  }

  public override render(): VNode {
    const internals = this as unknown as DialogInternals;
    const store = internals.store;
    const units = internals.unitsSettingManager;

    return (
      <div class={(this as unknown as { rootCssClass: any }).rootCssClass}>
        <div class='usr-wpt-dialog-top-row'>
          <GtcTouchButton
            class='usr-wpt-dialog-ident-button'
            onPressed={internals.selectIdent.bind(this)}
          >
            <div class='usr-wpt-dialog-ident-button-container'>
              <div class='usr-wpt-dialog-ident-button-ident'>
                {store.ident.map((ident) => (ident.length === 0 ? '______' : ident))}
              </div>
              <img
                src={`${G3000FilePaths.ASSETS_PATH}/Images/GTC/icon_small_user.png`}
                class='usr-wpt-dialog-ident-button-icon'
              />
            </div>
          </GtcTouchButton>
          <GtcToggleTouchButton
            state={store.isTemporary}
            label='Temporary'
            isEnabled={false}
            class='usr-wpt-dialog-temp-button'
          />
          {/* --- FIX INFO toggle: bound to our isFix Subject --- */}
          <GtcToggleTouchButton
            state={this.isFix}
            label='FIX'
            class='usr-wpt-dialog-temp-button fix-info-toggle'
          />
        </div>
        <GtcListSelectTouchButton
          gtcService={this.props.gtcService}
          listDialogKey={GtcViewKeys.ListDialog1}
          state={store.type}
          label='Type'
          listParams={{
            title: 'Select User Waypoint Type',
            inputData: [
              { value: TYPE_RAD_DIS, labelRenderer: () => TYPE_RAD_DIS },
              { value: TYPE_RAD_RAD, labelRenderer: () => TYPE_RAD_RAD },
              { value: TYPE_LAT_LON, labelRenderer: () => TYPE_LAT_LON },
              { value: TYPE_PPOS, labelRenderer: () => TYPE_PPOS },
            ],
            class: 'gtc-list-dialog-wide',
          }}
          class='usr-wpt-dialog-type-button'
        />
        <div class='usr-wpt-dialog-params'>
          <div class='usr-wpt-dialog-params-type usr-wpt-dialog-params-rad-dis'>
            <GtcValueTouchButton
              state={store.ref1}
              label='REF'
              renderValue={PARENT_STATIC.REFERENCE_FORMATTER}
              onPressed={(): void => {
                if (this.isFix.get()) {
                  void this.selectReferenceForFix(store.ref1);
                } else {
                  void internals.selectReference(store.ref1);
                }
              }}
              class='usr-wpt-dialog-ref-button'
            />
            <GtcValueTouchButton
              state={store.rad1}
              label='RAD'
              renderValue={
                <BearingDisplay
                  value={store.rad1}
                  displayUnit={units.navAngleUnits}
                  formatter={PARENT_STATIC.BEARING_FORMATTER}
                />
              }
              onPressed={(): void => { void internals.selectRadial(store.ref1.get(), store.rad1); }}
              class='usr-wpt-dialog-rad-button'
            />
            {/* --- RAD2 button: visible only when FIX toggle is ON --- */}
            <GtcValueTouchButton
              state={store.rad2}
              label='RAD2'
              renderValue={
                <BearingDisplay
                  value={store.rad2}
                  displayUnit={units.navAngleUnits}
                  formatter={PARENT_STATIC.BEARING_FORMATTER}
                />
              }
              onPressed={(): void => { void internals.selectRadial(store.ref1.get(), store.rad2); }}
              class={this.rad2Classes}
            />
            <GtcValueTouchButton
              state={store.dis1}
              label='DIS'
              renderValue={
                <NumberUnitDisplay
                  value={store.dis1}
                  displayUnit={units.distanceUnitsLarge}
                  formatter={PARENT_STATIC.DISTANCE_FORMATTER}
                />
              }
              onPressed={(): void => { void internals.selectDistance(store.dis1); }}
              class='usr-wpt-dialog-dis-button'
            />
          </div>
          <div class='usr-wpt-dialog-params-type usr-wpt-dialog-params-rad-rad'>
            <div class='usr-wpt-dialog-params-rad-rad-row'>
              <GtcValueTouchButton
                state={store.ref1}
                label='REF1'
                renderValue={PARENT_STATIC.REFERENCE_FORMATTER}
                onPressed={(): void => {
                if (this.isFix.get()) {
                  void this.selectReferenceForFix(store.ref1);
                } else {
                  void internals.selectReference(store.ref1);
                }
              }}
                class='usr-wpt-dialog-ref-button'
              />
              <GtcValueTouchButton
                state={store.rad1}
                label='RAD1'
                renderValue={
                  <BearingDisplay
                    value={store.rad1}
                    displayUnit={units.navAngleUnits}
                    formatter={PARENT_STATIC.BEARING_FORMATTER}
                  />
                }
                onPressed={(): void => { void internals.selectRadial(store.ref1.get(), store.rad1); }}
                class='usr-wpt-dialog-rad-button'
              />
            </div>
            <div class='usr-wpt-dialog-params-rad-rad-row'>
              <GtcValueTouchButton
                state={store.ref2}
                label='REF2'
                renderValue={PARENT_STATIC.REFERENCE_FORMATTER}
                onPressed={(): void => {
                if (this.isFix.get()) {
                  void this.selectReferenceForFix(store.ref2);
                } else {
                  void internals.selectReference(store.ref2);
                }
              }}
                class='usr-wpt-dialog-ref-button'
              />
              <GtcValueTouchButton
                state={store.rad2}
                label='RAD2'
                renderValue={
                  <BearingDisplay
                    value={store.rad2}
                    displayUnit={units.navAngleUnits}
                    formatter={PARENT_STATIC.BEARING_FORMATTER}
                  />
                }
                onPressed={(): void => { void internals.selectRadial(store.ref2.get(), store.rad2); }}
                class='usr-wpt-dialog-rad-button'
              />
            </div>
          </div>
          <div class='usr-wpt-dialog-params-type usr-wpt-dialog-params-lat-lon'>
            <GtcValueTouchButton
              state={store.latLon}
              label='LAT / LON'
              renderValue={
                <LatLonDisplay
                  value={store.latLon}
                  format={LatLonDisplayFormat.HDDD_MMmm}
                  class='usr-wpt-dialog-latlon-button-value'
                />
              }
              onPressed={(): void => { void internals.selectLatLon(store.latLon); }}
              isEnabled={store.type.map((t) => t === TYPE_LAT_LON)}
              class='usr-wpt-dialog-latlon-button'
            />
          </div>
        </div>
        <GtcValueTouchButton
          state={store.comment}
          label='Comment'
          onPressed={internals.selectComment.bind(this)}
          class='usr-wpt-dialog-comment-button'
        />
      </div>
    );
  }
}

function publishRemove(props: GtcUserWaypointDialogProps, ident: string): void {
  const bus = (props.gtcService as unknown as { bus?: { getPublisher: <T>() => { pub: (t: string, d: unknown, sync?: boolean, cache?: boolean) => void } } }).bus;
  if (!bus) return;
  bus.getPublisher<FixInfoEvents>().pub(FIXINFO_EVENT_TOPIC_REMOVED, { ident }, true, false);
  console.log('[FixInfo] published REMOVE for stale ident', ident);
}

function publishFixEvent(
  props: GtcUserWaypointDialogProps,
  uf: UserFacility,
  rad2MagFromStore: number | undefined,
): void {
  if (!uf.icaoStruct.ident.startsWith('FIX')) return;
  const bus = (props.gtcService as unknown as { bus?: { getPublisher: <T>() => { pub: (t: string, d: unknown, sync?: boolean, cache?: boolean) => void } } }).bus;
  if (!bus) {
    console.warn('[FixInfo] no bus on gtcService — cannot publish fix event');
    return;
  }
  const def = toFixDef(uf, rad2MagFromStore);
  if (def === null) return;
  bus.getPublisher<FixInfoEvents>().pub(FIXINFO_EVENT_TOPIC_INSERTED, def, true, false);
  console.log('[FixInfo] published FIX event for', def.ident, 'rad2=', rad2MagFromStore);
}

/**
 * Builds the auto-populated Comment string shown in the WT user-waypoint list.
 * Format depends on dialog Type:
 *   RAD/DIS without RAD2:  "270°/25NM"
 *   RAD/DIS with RAD2:     "270°/090°/25NM"
 *   RAD/RAD:               "270°/090°"
 *   LAT/LON or P.POS:      ""
 */
function computeFixComment(
  type: string,
  rad1: { number?: number } | null | undefined,
  rad2: { number?: number } | null | undefined,
  dis1: { number?: number } | null | undefined,
): string {
  const fmtDeg = (v?: number): string =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.round(((v % 360) + 360) % 360).toString().padStart(3, '0') + '°'
      : '';
  const fmtDis = (v?: number): string =>
    typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}NM` : '';
  const r1 = fmtDeg(rad1?.number);
  const r2 = fmtDeg(rad2?.number);
  const d = fmtDis(dis1?.number);
  if (type === 'RAD / DIS') return r2 ? `${r1}/${r2}/${d}` : `${r1}/${d}`;
  if (type === 'RAD / RAD') return `${r1}/${r2}`;
  return '';
}

function toFixDef(uf: UserFacility, rad2: number | undefined): FixDefinition | null {
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
        radial2Mag: typeof rad2 === 'number' && Number.isFinite(rad2) ? rad2 : undefined,
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
