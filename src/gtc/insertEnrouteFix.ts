import { EventBus, UserFacility } from '@microsoft/msfs-sdk';
import {
  GtcService,
  GtcUserWaypointDialog,
  GtcUserWaypointDialogCreateInput,
  GtcViewKeys,
} from '@microsoft/msfs-wtg3000-gtc';

/**
 * Module-level flag read by FixInfoUserWaypointDialog (or its setAutoIdent
 * override) to decide whether the dialog mints FIX- or USR-prefixed idents.
 * Set true by createFix() before opening the dialog; the FIX toggle inside the
 * dialog owns it during the session.
 */
export const fixModeState = {
  on: false,
};

/**
 * Opens the user-waypoint dialog (replaced by our subclass via onComponentCreating).
 * Pre-activates FIX mode so the auto-ident generates FIX###. The actual event
 * publish to the bus is handled inside the dialog subclass' cleanupRequest hook,
 * so it fires once for both this entry point and the WT-native Create flow.
 */
export async function createFix(
  gtcService: GtcService,
  _bus: EventBus,
): Promise<UserFacility | null> {
  fixModeState.on = true;
  console.log('[FixInfo] createFix: opening dialog with FIX mode active');

  const result = await gtcService
    .openPopup<GtcUserWaypointDialog>(GtcViewKeys.UserWaypointDialog, 'normal', 'hide')
    .ref.request({} as GtcUserWaypointDialogCreateInput);
  if (result.wasCancelled) return null;
  return result.payload;
}
