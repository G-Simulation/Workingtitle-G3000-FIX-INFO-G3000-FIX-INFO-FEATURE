import { DisplayComponent, DisplayComponentFactory, registerPlugin } from '@microsoft/msfs-sdk';
import {
  AbstractG3000GtcPlugin,
  GtcUserWaypointDialog,
  WaypointOptionsSlideoutMenu,
} from '@microsoft/msfs-wtg3000-gtc';

import { DevPanel } from '../shared/DevPanel';
import { FIXINFO_RELOAD_TOPIC, FixInfoReloadEvents } from '../shared/FixTypes';
import { FixInfoUserWaypointDialog } from './dialog/FixInfoUserWaypointDialog';
import { FixInfoWaypointOptionsSlideoutMenu } from './dialog/FixInfoWaypointOptionsSlideoutMenu';
import { FixDefinitionCache } from './FixDefinitionCache';

class G3000FixGtcPlugin extends AbstractG3000GtcPlugin {
  private devPanel: DevPanel | null = null;

  public onInstalled(): void {
    console.log('[FixInfo] GTC plugin installed');
  }

  /**
   * Plugin hook fired BEFORE every component instantiation. We use it to swap
   * the WT user-waypoint dialog with our subclass — the framework then uses our
   * instance everywhere the original would have been used.
   */
  public onComponentCreating: NonNullable<AbstractG3000GtcPlugin['onComponentCreating']> = (
    ctor: DisplayComponentFactory<any>,
    props: any,
  ): DisplayComponent<any> | undefined => {
    if (ctor === GtcUserWaypointDialog) {
      console.log('[FixInfo] intercepting GtcUserWaypointDialog construction → using FixInfoUserWaypointDialog');
      return new FixInfoUserWaypointDialog(props);
    }
    if (ctor === WaypointOptionsSlideoutMenu) {
      console.log('[FixInfo] intercepting WaypointOptionsSlideoutMenu construction → using FixInfoWaypointOptionsSlideoutMenu');
      return new FixInfoWaypointOptionsSlideoutMenu(props);
    }
    return undefined;
  };

  public onInit(): void {
    console.log('[FixInfo] GTC plugin initialized');
    FixDefinitionCache.init(this.binder.bus);
    this.devPanel = new DevPanel({
      title: 'FixInfo GTC',
      accent: '#c00',
      onReload: () => {
        this.binder.bus
          .getPublisher<FixInfoReloadEvents>()
          .pub(FIXINFO_RELOAD_TOPIC, { from: 'gtc' }, true, false);
      },
    });
    this.devPanel.setStatus('plugin: ok\nready');
  }
}

registerPlugin(G3000FixGtcPlugin);
