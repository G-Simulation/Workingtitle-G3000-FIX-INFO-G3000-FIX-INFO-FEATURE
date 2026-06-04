import { describe, expect, it } from 'vitest';

import {
  EARTH_RADIUS_NM,
  destinationFromBearingDistance,
  distanceNm,
  greatCircleSamples,
  initialTrueBearing,
  magneticToTrue,
  normalize360,
  normalizeLon,
  trueToMagnetic,
} from '../src/shared/FixGeometry';

// 60 NM east at equator -> expected longitude in degrees (angular distance in degrees)
const SIXTY_NM_AS_DEG = (60 / EARTH_RADIUS_NM) * (180 / Math.PI);

describe('normalize360', () => {
  it('wraps negative values into [0, 360)', () => {
    expect(normalize360(-1)).toBeCloseTo(359, 6);
    expect(normalize360(-359)).toBeCloseTo(1, 6);
    expect(normalize360(-720.5)).toBeCloseTo(359.5, 6);
  });
  it('wraps values >= 360', () => {
    expect(normalize360(360)).toBeCloseTo(0, 6);
    expect(normalize360(361)).toBeCloseTo(1, 6);
    expect(normalize360(720)).toBeCloseTo(0, 6);
  });
  it('passes values already in [0, 360) unchanged', () => {
    expect(normalize360(0)).toBe(0);
    expect(normalize360(180)).toBe(180);
    expect(normalize360(359.999)).toBeCloseTo(359.999, 6);
  });
});

describe('normalizeLon', () => {
  it('wraps to (-180, 180]', () => {
    expect(normalizeLon(181)).toBeCloseTo(-179, 6);
    expect(normalizeLon(-181)).toBeCloseTo(179, 6);
    expect(normalizeLon(540)).toBeCloseTo(180, 6);
    expect(normalizeLon(0)).toBe(0);
  });
});

describe('magneticToTrue / trueToMagnetic (East magvar positive convention)', () => {
  it('east magvar (+13E) means magnetic reads less than true: true = mag + magVar', () => {
    expect(magneticToTrue(90, 13)).toBeCloseTo(103, 6);
  });
  it('west magvar (-7) means magnetic reads more than true: true = mag - 7', () => {
    expect(magneticToTrue(90, -7)).toBeCloseTo(83, 6);
  });
  it('wraps across 360 boundary', () => {
    expect(magneticToTrue(355, 10)).toBeCloseTo(5, 6);
    expect(trueToMagnetic(5, 10)).toBeCloseTo(355, 6);
  });
  it('round-trips', () => {
    for (const mag of [0, 45, 90, 180, 270, 359]) {
      for (const mv of [-25, -10, 0, 5, 17]) {
        expect(trueToMagnetic(magneticToTrue(mag, mv), mv)).toBeCloseTo(mag, 6);
      }
    }
  });
});

describe('destinationFromBearingDistance', () => {
  it('60 NM east from (0,0) lands near (0, +SIXTY_NM_AS_DEG)', () => {
    const r = destinationFromBearingDistance(0, 0, 90, 60);
    expect(r.lat).toBeCloseTo(0, 6);
    expect(r.lon).toBeCloseTo(SIXTY_NM_AS_DEG, 4);
  });
  it('1 NM north from equator increases latitude by ~1/60 deg', () => {
    const r = destinationFromBearingDistance(0, 0, 0, 1);
    expect(r.lat).toBeCloseTo(1 / 60, 4);
    expect(r.lon).toBeCloseTo(0, 6);
  });
  it('round trip: destination + reverse bearing = original', () => {
    const start = { lat: 47.45, lon: 8.55 };
    const dest = destinationFromBearingDistance(start.lat, start.lon, 120, 250);
    const d = distanceNm(start, dest);
    expect(d).toBeCloseTo(250, 1);
    const brg = initialTrueBearing(start, dest);
    expect(normalize360(brg)).toBeCloseTo(120, 1);
  });
  it('handles antimeridian crossing without producing |lon| > 180', () => {
    const r = destinationFromBearingDistance(0, 179.5, 90, 60);
    expect(r.lon).toBeGreaterThan(-180);
    expect(r.lon).toBeLessThanOrEqual(180);
  });
});

const EARTH_NM_PER_DEG_AT_EQUATOR = 60.04;

const ONE_DEG_AS_NM = EARTH_RADIUS_NM * (Math.PI / 180);

describe('distanceNm', () => {
  it('equator: 1 deg lon ~= ONE_DEG_AS_NM', () => {
    expect(distanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(ONE_DEG_AS_NM, 2);
  });
  it('any meridian: 1 deg lat ~= ONE_DEG_AS_NM', () => {
    expect(distanceNm({ lat: 40, lon: -10 }, { lat: 41, lon: -10 })).toBeCloseTo(ONE_DEG_AS_NM, 2);
  });
  it('is symmetric', () => {
    const a = { lat: 47.45, lon: 8.55 };
    const b = { lat: 51.5, lon: -0.1 };
    expect(distanceNm(a, b)).toBeCloseTo(distanceNm(b, a), 6);
  });
});

describe('initialTrueBearing', () => {
  it('due north', () => {
    expect(initialTrueBearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
  });
  it('due east at equator', () => {
    expect(initialTrueBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
  });
  it('due south', () => {
    expect(initialTrueBearing({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 6);
  });
  it('due west at equator', () => {
    expect(initialTrueBearing({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 6);
  });
});

describe('greatCircleSamples', () => {
  it('returns segments + 1 points', () => {
    const samples = greatCircleSamples({ lat: 0, lon: 0 }, { lat: 0, lon: 60 }, 12);
    expect(samples).toHaveLength(13);
  });
  it('first sample == from, last == to', () => {
    const from = { lat: 47.45, lon: 8.55 };
    const to = { lat: 51.5, lon: -0.1 };
    const samples = greatCircleSamples(from, to, 10);
    expect(samples[0].lat).toBeCloseTo(from.lat, 5);
    expect(samples[0].lon).toBeCloseTo(from.lon, 5);
    expect(samples[10].lat).toBeCloseTo(to.lat, 5);
    expect(samples[10].lon).toBeCloseTo(to.lon, 5);
  });
  it('midpoint of equatorial segment lies on equator', () => {
    const samples = greatCircleSamples({ lat: 0, lon: 0 }, { lat: 0, lon: 60 }, 2);
    expect(samples[1].lat).toBeCloseTo(0, 5);
    expect(samples[1].lon).toBeCloseTo(30, 5);
  });
  it('handles zero-length input (from == to)', () => {
    const samples = greatCircleSamples({ lat: 47.45, lon: 8.55 }, { lat: 47.45, lon: 8.55 }, 4);
    expect(samples).toHaveLength(5);
    for (const s of samples) {
      expect(s.lat).toBeCloseTo(47.45, 5);
      expect(s.lon).toBeCloseTo(8.55, 5);
    }
  });
});
