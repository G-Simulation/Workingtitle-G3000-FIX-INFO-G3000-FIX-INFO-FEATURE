import { Facility, Subscribable, VNode } from '@microsoft/msfs-sdk';
import {
  GtcUserWaypointDialog,
  GtcUserWaypointDialogCreateInput,
  GtcViewKeys,
  WaypointOptionsSlideoutMenu,
  WaypointOptionsSlideoutMenuProps,
} from '@microsoft/msfs-wtg3000-gtc';

import { fixModeState } from '../insertEnrouteFix';

/* No extra CSS — we keep the original 5 rows and only stuff our FIX button
 * into the row already containing Load Airway (3 buttons in that row). */
function ensureFixInfoSlideoutCss(): void { /* no-op kept for symmetry */ }

/**
 * Module-level handoff: FixInfoUserWaypointDialog consumes this on its next
 * request() and pre-fills REF1 with this facility. Cleared after consumption.
 */
export const pendingRef1State: { facility: Facility | null } = { facility: null };

/**
 * Subclass of the WT Waypoint-Options slideout (the popup shown when tapping a
 * leg in the GTC Flight Plan page). Adds a "FIX" button that opens the
 * UserWaypointDialog in FIX mode with the tapped waypoint pre-loaded as REF1.
 * The button is injected via DOM manipulation in onAfterRender so we don't
 * have to reimplement the parent's render() — keeps us robust against WT
 * layout changes inside the menu.
 */
export class FixInfoWaypointOptionsSlideoutMenu extends WaypointOptionsSlideoutMenu {
  public constructor(props: WaypointOptionsSlideoutMenuProps) {
    super(props);
    ensureFixInfoSlideoutCss();
  }

  public onAfterRender(thisNode: VNode): void {
    super.onAfterRender(thisNode);
    // Defer so WT's own DOM mounting is complete first.
    setTimeout(() => this.injectFixButton(thisNode), 0);
  }

  /** Walks the VNode tree depth-first and returns the first HTMLElement found. */
  private findRootElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== 'object') return null;
    const n = node as { instance?: unknown; children?: unknown[] };
    if (n.instance instanceof HTMLElement) return n.instance;
    if (Array.isArray(n.children)) {
      for (const c of n.children) {
        const found = this.findRootElement(c);
        if (found) return found;
      }
    }
    return null;
  }

  private injectFixButton(thisNode: VNode): void {
    const rootEl = this.findRootElement(thisNode);
    if (!rootEl) {
      console.warn('[FixInfo] WaypointOptionsSlideoutMenu — could not locate DOM root');
      return;
    }
    if (rootEl.querySelector('.fix-info-button')) return; // already injected

    // Build the FIX button element.
    const fixBtn = document.createElement('div');
    fixBtn.className = 'touch-button fix-info-button';
    const fixLabel = document.createElement('div');
    fixLabel.className = 'touch-button-label';
    fixLabel.textContent = 'FIX INFO';
    fixBtn.appendChild(fixLabel);
    fixBtn.addEventListener('click', () => { this.onFixButtonPressed(); });

    // Collect existing buttons across all rows in DOM order.
    const rows = Array.from(rootEl.querySelectorAll(':scope > .slideout-grid-row')) as HTMLElement[];
    const buttons: HTMLElement[] = [];
    for (const r of rows) {
      for (const child of Array.from(r.children)) buttons.push(child as HTMLElement);
    }
    // Find Load Airway by label and insert FIX immediately before it.
    let insertIdx = buttons.length;
    for (let i = 0; i < buttons.length; i++) {
      const txt = (buttons[i].querySelector('.touch-button-label')?.textContent ?? '')
        .trim().toLowerCase().replace(/\s+/g, ' ');
      if (txt === 'load airway') { insertIdx = i; break; }
    }
    buttons.splice(insertIdx, 0, fixBtn);

    // Re-flow into the EXISTING rows (preserves WT-mounted row state/styling);
    // append additional rows only for the leftover that doesn't fit. We clone
    // the className from an existing row so any layout classes carry over.
    const rowClassName = rows[0]?.className ?? 'slideout-grid-row';
    let bi = 0;
    for (const r of rows) {
      while (r.firstChild) r.removeChild(r.firstChild);
      if (bi < buttons.length) r.appendChild(buttons[bi++]);
      if (bi < buttons.length) r.appendChild(buttons[bi++]);
    }
    while (bi < buttons.length) {
      const newRow = document.createElement('div');
      newRow.className = rowClassName;
      newRow.appendChild(buttons[bi++]);
      if (bi < buttons.length) newRow.appendChild(buttons[bi++]);
      rootEl.appendChild(newRow);
    }
    console.log(`[FixInfo] FIX inserted at flow position ${insertIdx} (before "Load Airway")`);
  }

  private onFixButtonPressed(): void {
    const facSub = (this as unknown as { facility?: Subscribable<Facility | null> }).facility;
    const facility = facSub?.get?.() ?? null;
    if (!facility) {
      console.warn('[FixInfo] Waypoint Options FIX button pressed but no facility available');
      return;
    }
    console.log('[FixInfo] Waypoint Options FIX button pressed for', facility.icaoStruct?.ident);
    pendingRef1State.facility = facility;
    fixModeState.on = true;
    // Open the user-waypoint dialog. Our FixInfoUserWaypointDialog's request()
    // consumes pendingRef1State and pre-fills store.ref1.
    this.props.gtcService
      .openPopup<GtcUserWaypointDialog>(GtcViewKeys.UserWaypointDialog, 'normal', 'hide')
      .ref.request({} as GtcUserWaypointDialogCreateInput);
  }
}
