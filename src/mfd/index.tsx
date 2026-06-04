import { DisplayComponent, DisplayComponentFactory, registerPlugin } from '@microsoft/msfs-sdk';
import { AbstractG3000MfdPlugin } from '@microsoft/msfs-wtg3000-mfd';

import { PANE_VIEW_OVERRIDES, setAttachHook } from './MapPaneViews';

import {
  FIXINFO_RELOAD_TOPIC,
  FixInfoReloadEvents,
} from '../shared/FixTypes';
import { BearingOverlayCanvas } from './BearingOverlayCanvas';
import { FixDefinitionStore } from './FixDefinitionStore';


class G3000FixMfdPlugin extends AbstractG3000MfdPlugin {
  private store: FixDefinitionStore | null = null;
  private readonly overlays = new WeakMap<object, BearingOverlayCanvas>();

  public onInstalled(): void {
    console.log('[FixInfo] MFD plugin installed');
    // Register the attach hook so our pane-view subclasses can call back.
    setAttachHook((view, thisNode) => this.attachOverlay(view, thisNode));
  }

  public onInit(): void {
    console.log('[FixInfo] MFD plugin initialized');
    this.store = new FixDefinitionStore(this.binder.bus, this.binder.facLoader);
    // Cross-instrument reload trigger: GTC publishes when its reload is tapped.
    this.binder.bus
      .getSubscriber<FixInfoReloadEvents>()
      .on(FIXINFO_RELOAD_TOPIC)
      .handle((evt) => {
        console.log('[FixInfo] reload request received from', evt.from);
        location.reload();
      });
  }

  /**
   * Plugin hook fired BEFORE every component instantiation. We intercept WT's
   * pane-view classes and substitute our subclasses (which override onAfterRender
   * to call our attach logic). Subclasses inherit ALL behavior — no JSX duplication,
   * no fragile prototype patches.
   */
  public onComponentCreating: NonNullable<AbstractG3000MfdPlugin['onComponentCreating']> = (
    ctor: DisplayComponentFactory<any>,
    props: any,
  ): DisplayComponent<any> | undefined => {
    const Override = PANE_VIEW_OVERRIDES.get(ctor);
    if (Override) {
      console.log(`[FixInfo] substituting pane view ${(ctor as { name?: string }).name ?? '?'} with override`);
      return new Override(props);
    }
    return undefined;
  };

  private attachOverlay(view: object, _thisNode?: unknown): void {
    if (this.store === null) return;
    if (this.overlays.has(view)) return;

    const v = view as {
      compiledMap?: {
        context?: { projection?: unknown };
        map?: { root?: unknown; children?: Array<{ root?: unknown } | null> | null };
      };
    };
    const projection = v.compiledMap?.context?.projection;
    if (!projection || typeof (projection as { project?: unknown }).project !== 'function') {
      console.warn('[FixInfo] view has no compiledMap.context.projection');
      return;
    }

    // Attach to the MAP root (the inner `common-map nav-map` <div> that hosts
    // tiles, flight plan and aircraft). The pane root (`.nav-map-pane`) also
    // contains an inset sibling (Active Flight Plan / VSD / Progress) — we
    // must NOT cover that.
    //
    // compiledMap.map is the VNode for the MapSystemComponent (a class
    // component). FSComponent does NOT set `.root` on class-component VNodes —
    // only the children's `.root` is populated with their rendered DOM. So we
    // walk children to find the actual <div class="common-map nav-map">.
    const root = this.findMapRoot(v.compiledMap?.map);
    if (!root) {
      console.warn('[FixInfo] could not locate inner map DOM root');
      return;
    }

    root.setAttribute('data-fix-info-attached', '1');
    const cs = window.getComputedStyle(root);
    if (cs.position === 'static' || cs.position === '') {
      root.style.position = 'relative';
    }

    requestAnimationFrame(() => {
      const overlay = new BearingOverlayCanvas(
        root,
        projection as ConstructorParameters<typeof BearingOverlayCanvas>[1],
        this.store!,
      );
      this.overlays.set(view, overlay);
      console.log('[FixInfo] overlay attached to map root', root.className);
    });
  }

  /**
   * Walks a class-component VNode's child VNodes to find the first one whose
   * .root is a real DOM element. Used to dig out the MapSystemComponent's
   * rendered <div class="common-map nav-map"> since FSComponent only populates
   * .root on the leaf DOM VNodes, not on the wrapping class-component VNode.
   */
  private findMapRoot(vnode: { root?: unknown; children?: Array<{ root?: unknown } | null> | null } | undefined): HTMLElement | null {
    if (!vnode) return null;
    if (vnode.root && (vnode.root as { nodeType?: number }).nodeType === 1) {
      return vnode.root as HTMLElement;
    }
    if (Array.isArray(vnode.children)) {
      for (const c of vnode.children) {
        const found = this.findMapRoot(c ?? undefined);
        if (found) return found;
      }
    }
    return null;
  }

}

registerPlugin(G3000FixMfdPlugin);
