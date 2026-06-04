export const EARTH_RADIUS_NM = 3440.065;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function normalize360(deg: number): number {
  const x = deg % 360;
  return x < 0 ? x + 360 : x;
}

export function normalizeLon(deg: number): number {
  let x = deg;
  while (x > 180) x -= 360;
  while (x <= -180) x += 360;
  return x;
}

export function magneticToTrue(magneticDeg: number, magVarDeg: number): number {
  return normalize360(magneticDeg + magVarDeg);
}

export function trueToMagnetic(trueDeg: number, magVarDeg: number): number {
  return normalize360(trueDeg - magVarDeg);
}

export interface LatLon {
  lat: number;
  lon: number;
}

export function destinationFromBearingDistance(
  lat: number,
  lon: number,
  trueBearingDeg: number,
  distanceNm: number,
): LatLon {
  const angDist = distanceNm / EARTH_RADIUS_NM;
  const brg = trueBearingDeg * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lon1 = lon * DEG_TO_RAD;

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angDist);
  const cosAng = Math.cos(angDist);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(brg));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * sinAng * cosLat1,
      cosAng - sinLat1 * Math.sin(lat2),
    );

  return {
    lat: lat2 * RAD_TO_DEG,
    lon: normalizeLon(lon2 * RAD_TO_DEG),
  };
}

export function distanceNm(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function initialTrueBearing(from: LatLon, to: LatLon): number {
  const lat1 = from.lat * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const dLon = (to.lon - from.lon) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalize360(Math.atan2(y, x) * RAD_TO_DEG);
}

/**
 * Samples evenly spaced intermediate points along the great circle between two endpoints.
 * Returns `segments + 1` points (including both endpoints) so a caller can draw `segments`
 * line segments. Used by the MFD layer to draw a curved bearing line on the projected map.
 */
export function greatCircleSamples(
  from: LatLon,
  to: LatLon,
  segments: number,
): LatLon[] {
  if (segments < 1) return [from, to];
  const lat1 = from.lat * DEG_TO_RAD;
  const lon1 = from.lon * DEG_TO_RAD;
  const lat2 = to.lat * DEG_TO_RAD;
  const lon2 = to.lon * DEG_TO_RAD;
  const dLat = (to.lat - from.lat) * DEG_TO_RAD;
  const dLon = (to.lon - from.lon) * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const angDist = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  if (angDist === 0) {
    return Array.from({ length: segments + 1 }, () => ({ lat: from.lat, lon: from.lon }));
  }

  const sinAng = Math.sin(angDist);
  const out: LatLon[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const A = Math.sin((1 - f) * angDist) / sinAng;
    const B = Math.sin(f * angDist) / sinAng;
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);
    out.push({ lat: lat * RAD_TO_DEG, lon: normalizeLon(lon * RAD_TO_DEG) });
  }
  return out;
}
