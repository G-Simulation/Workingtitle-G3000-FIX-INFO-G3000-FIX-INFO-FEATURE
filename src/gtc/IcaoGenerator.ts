import { ICAO, IcaoType, IcaoValue } from '@microsoft/msfs-sdk';
import { G3000FacilityUtils } from '@microsoft/msfs-wtg3000-common';

const PREFIX = 'PFIX';
const KEY = 'fixinfo_counter';

function readCounter(): number {
  if (typeof localStorage === 'undefined') return 0;
  const raw = localStorage.getItem(KEY);
  const n = raw === null ? 0 : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function writeCounter(n: number): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, String(n)); } catch { /* localStorage quota or disabled — ignore */ }
}

export interface GeneratedIcao {
  ident: string;
  icaoValue: IcaoValue;
}

export function nextFixIcao(): GeneratedIcao {
  const next = (readCounter() + 1) % 100;
  writeCounter(next);
  const ident = `${PREFIX}${next.toString().padStart(2, '0')}`;
  const icaoValue = ICAO.value(IcaoType.User, '', G3000FacilityUtils.USER_FACILITY_SCOPE, ident);
  return { ident, icaoValue };
}
