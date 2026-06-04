import { IcaoValue } from '@microsoft/msfs-sdk';

export type FixMode = 'RAD_DIS' | 'RAD_RAD' | 'LAT_LON';

interface FixDefinitionBase {
  ident: string;
  resultLat: number;
  resultLon: number;
  insertedAt: number;
}

export interface FixDefinitionRadDis extends FixDefinitionBase {
  mode: 'RAD_DIS';
  place1Icao: IcaoValue;
  place1MagVar: number;
  radial1Mag: number;
  distanceNm: number;
  /** Optional 2nd magnetic radial from the same Place — drawn as an additional bearing line. */
  radial2Mag?: number;
}

export interface FixDefinitionRadRad extends FixDefinitionBase {
  mode: 'RAD_RAD';
  place1Icao: IcaoValue;
  place1MagVar: number;
  radial1Mag: number;
  place2Icao: IcaoValue;
  place2MagVar: number;
  radial2Mag: number;
}

export interface FixDefinitionLatLon extends FixDefinitionBase {
  mode: 'LAT_LON';
}

export type FixDefinition = FixDefinitionRadDis | FixDefinitionRadRad | FixDefinitionLatLon;

export interface FixInfoEvents {
  fixinfo_inserted: FixDefinition;
  fixinfo_removed: { ident: string };
}

export const FIXINFO_EVENT_TOPIC_INSERTED = 'fixinfo_inserted' as const;
export const FIXINFO_EVENT_TOPIC_REMOVED = 'fixinfo_removed' as const;

export const FIXINFO_RELOAD_TOPIC = 'fixinfo_reload_request' as const;

export interface FixInfoReloadEvents {
  fixinfo_reload_request: { from: string };
}
