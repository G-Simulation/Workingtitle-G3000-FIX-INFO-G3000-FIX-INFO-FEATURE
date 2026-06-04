import { VNode } from '@microsoft/msfs-sdk';
import {
  ConnextWeatherPaneView,
  NavigationMapPaneView,
  NearestPaneView,
  ProcedurePreviewPaneView,
  TrafficMapPaneView,
  WaypointInfoPaneView,
} from '@microsoft/msfs-wtg3000-common';

export type OverlayAttachHook = (view: object, thisNode: VNode | undefined) => void;

let attachHook: OverlayAttachHook = () => { /* set by plugin */ };

export function setAttachHook(hook: OverlayAttachHook): void {
  attachHook = hook;
}

// WT declares the pane views' onAfterRender as `(): void` but the FSComponent
// framework passes the rendered VNode as the first argument. We override with
// `(thisNode: VNode): void` so we can capture it cleanly; the @ts-expect-error
// suppresses the (technically valid but practically wrong) base signature.

export class FixInfoNavigationMapPaneView extends NavigationMapPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

export class FixInfoTrafficMapPaneView extends TrafficMapPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

export class FixInfoProcedurePreviewPaneView extends ProcedurePreviewPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

export class FixInfoNearestPaneView extends NearestPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

export class FixInfoWaypointInfoPaneView extends WaypointInfoPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

export class FixInfoConnextWeatherPaneView extends ConnextWeatherPaneView {
  // @ts-expect-error WT base declares no arg; framework actually passes thisNode.
  public override onAfterRender(thisNode: VNode): void {
    super.onAfterRender();
    attachHook(this, thisNode);
  }
}

// TEMPORARY: only NavMap. The other pane subclasses caused MFD init to fail —
// likely props/lifecycle differences. Re-enable them one at a time after fixing
// the constructor pass-through.
export const PANE_VIEW_OVERRIDES: ReadonlyMap<unknown, new (props: any) => any> = new Map<unknown, new (props: any) => any>([
  [NavigationMapPaneView, FixInfoNavigationMapPaneView],
]);
