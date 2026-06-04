import { Subject } from '@microsoft/msfs-sdk';

/**
 * Global runtime toggle for all debug UI (DevPanel, yellow canvas rect, console
 * capture). Default is ON for development. The DevPanel has an X button that
 * flips this off — once off, DevPanel hides itself and the canvas overlay stops
 * rendering its debug rect.
 */
export const debugEnabled = Subject.create<boolean>(false);
