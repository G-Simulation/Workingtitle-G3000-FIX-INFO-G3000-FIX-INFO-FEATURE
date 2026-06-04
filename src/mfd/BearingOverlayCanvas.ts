import { MapProjection, MapProjectionChangeListener } from '@microsoft/msfs-sdk';

import { IcaoValue } from '@microsoft/msfs-sdk';

import { destinationFromBearingDistance, magneticToTrue } from '../shared/FixGeometry';
import { FixDefinitionRadDis } from '../shared/FixTypes';
import { FixDefinitionStore, ResolvedFix } from './FixDefinitionStore';

type ResolvedFixRadDis = { def: FixDefinitionRadDis; fix: ResolvedFix };

function placeKey(icao: IcaoValue): string {
  return `${icao.region}|${icao.airport}|${icao.ident}|${icao.type}`;
}

function addUniqueBearing(arr: number[], deg: number): void {
  if (arr.length >= 2) return;
  const n = ((deg % 360) + 360) % 360;
  for (const e of arr) {
    if (Math.abs(e - n) < 0.5 || Math.abs(e - n - 360) < 0.5 || Math.abs(e - n + 360) < 0.5) return;
  }
  arr.push(n);
}

const COLOR_STROKE = '#00ffff';
const COLOR_FILL = 'rgba(0, 255, 255, 0.15)';
const COLOR_TEXT = '#00ffff';
const COLOR_TEXT_HALO = 'rgba(0, 0, 0, 0.8)';

/**
 * An absolute-positioned canvas overlay that lives on top of a WT NavigationMapPaneView's
 * map area and paints additional FIX INFO visuals (a circle around each fix and one or
 * two dashed bearing lines from the reference Place(s) to the fix). Projection comes from
 * the live WT MapProjection — so our overlay stays perfectly aligned with the underlying
 * map as the user pans/zooms/rotates.
 */
export class BearingOverlayCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly outVec = new Float64Array(2);
  private readonly storeUnsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver | null;
  private rafHandle = 0;
  private isDestroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly projection: MapProjection,
    private readonly store: FixDefinitionStore,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.classList.add('fix-info-overlay-canvas');
    this.canvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10000;';
    (this.canvas as unknown as { __fixInfoOverlay: BearingOverlayCanvas }).__fixInfoOverlay = this;
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (ctx === null) throw new Error('[FixInfo] failed to acquire 2D canvas context');
    this.ctx = ctx;

    this.resize();

    // Store changes need to invalidate immediately; per-frame redraw covers projection changes.
    this.storeUnsubscribe = this.store.addListener(() => { /* RAF loop picks it up */ });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => { this.resize(); });
      this.resizeObserver.observe(container);
    } else {
      this.resizeObserver = null;
    }

    this.tick = this.tick.bind(this);
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  private tick(): void {
    if (this.isDestroyed) return;
    this.resize();
    this.draw();
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    if (this.rafHandle !== 0) cancelAnimationFrame(this.rafHandle);
    this.storeUnsubscribe();
    this.resizeObserver?.disconnect();
    this.canvas.remove();
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(rect.width * dpr);
    const py = Math.round(rect.height * dpr);
    if (this.canvas.width !== px || this.canvas.height !== py) {
      this.canvas.width = px;
      this.canvas.height = py;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  /** Last debug snapshot the panel can read for status display. */
  public lastDebug: {
    canvasW: number; canvasH: number;
    containerW: number; containerH: number;
    projW: number; projH: number;
    firstFixPx?: { fx: number; fy: number; px?: number; py?: number; placesCount: number; mode: string };
  } = { canvasW: 0, canvasH: 0, containerW: 0, containerH: 0, projW: 0, projH: 0 };

  /** Bounding boxes of idents already placed in the current draw() — used to
   *  detect and stagger overlapping labels when multiple fixes land at (or near)
   *  the same screen position. Reset at the start of every frame. */
  private readonly placedLabelBoxes: { x: number; y: number; w: number; h: number }[] = [];

  private draw(): void {
    if (this.isDestroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.width / dpr;
    const h = this.canvas.height / dpr;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this.placedLabelBoxes.length = 0;

    const rect = this.container.getBoundingClientRect();
    const projSize = (this.projection as unknown as { getProjectedSize: () => Float64Array }).getProjectedSize();
    this.lastDebug.canvasW = Math.round(w);
    this.lastDebug.canvasH = Math.round(h);
    this.lastDebug.containerW = Math.round(rect.width);
    this.lastDebug.containerH = Math.round(rect.height);
    this.lastDebug.projW = Math.round(projSize[0]);
    this.lastDebug.projH = Math.round(projSize[1]);

    const fixes = this.store.snapshot;
    if (fixes.size === 0) return;

    // Group RAD_DIS fixes by their Place icao. Within each group, the bearing
    // set is the UNION of every member's radial1Mag (+ radial2Mag when set),
    // capped at 2 unique bearings. Every member fix shares those bearings.
    type Group = { placeIcao: string; placeLat: number; placeLon: number; placeMagVar: number; fixes: ResolvedFixRadDis[]; bearings: number[]; };
    const groups = new Map<string, Group>();
    const otherFixes: { def: import('../shared/FixTypes').FixDefinition; places: { lat: number; lon: number }[]; }[] = [];

    for (const fix of fixes.values()) {
      const def = fix.definition;
      if (def.mode === 'RAD_DIS' && fix.places.length === 1) {
        const key = placeKey(def.place1Icao);
        let g = groups.get(key);
        if (!g) {
          g = {
            placeIcao: key,
            placeLat: fix.places[0].lat,
            placeLon: fix.places[0].lon,
            placeMagVar: def.place1MagVar,
            fixes: [],
            bearings: [],
          };
          groups.set(key, g);
        }
        g.fixes.push({ def, fix });
        addUniqueBearing(g.bearings, def.radial1Mag);
        if (typeof def.radial2Mag === 'number') addUniqueBearing(g.bearings, def.radial2Mag);
      } else {
        otherFixes.push({ def, places: fix.places });
      }
    }

    // Render each RAD_DIS group: one circle per fix, one set of bearings shared.
    for (const g of groups.values()) {
      this.drawRadDisGroup(g);
    }

    // Render RAD_RAD / LAT_LON / future modes individually.
    for (const fix of otherFixes) {
      this.projection.project({ lat: fix.def.resultLat, lon: fix.def.resultLon }, this.outVec);
      const fx = this.outVec[0];
      const fy = this.outVec[1];
      if (fix.def.mode === 'RAD_RAD' && fix.places.length === 2) {
        for (const place of fix.places) {
          this.projection.project({ lat: place.lat, lon: place.lon }, this.outVec);
          this.drawRadialLine(fx, fy, this.outVec[0], this.outVec[1]);
        }
      }
      this.drawFixMarker(fx, fy);
      this.drawIdent(fx + 14, fy - 8, fix.def.ident);
    }
  }

  private drawRadDisGroup(g: { placeLat: number; placeLon: number; placeMagVar: number; fixes: ResolvedFixRadDis[]; bearings: number[] }): void {
    this.projection.project({ lat: g.placeLat, lon: g.placeLon }, this.outVec);
    const px = this.outVec[0];
    const py = this.outVec[1];

    // Derive pxPerNm by sampling a known 1-NM geodesic step from the place,
    // not from the fix's stored resultLat/resultLon. This keeps the circle
    // perfectly centred on the place even when WT's reference position for
    // the fix's result (e.g. for RWY refs) doesn't match our place position.
    const sampleStep = destinationFromBearingDistance(g.placeLat, g.placeLon, 0, 1);
    this.projection.project({ lat: sampleStep.lat, lon: sampleStep.lon }, this.outVec);
    const pxPerNm = Math.hypot(this.outVec[0] - px, this.outVec[1] - py);

    const radii: { fix: ResolvedFixRadDis; radiusPx: number }[] = [];
    for (const m of g.fixes) {
      radii.push({ fix: m, radiusPx: pxPerNm * m.def.distanceNm });
    }
    const maxRadius = radii.reduce((m, r) => Math.max(m, r.radiusPx), 0);
    const extendPx = pxPerNm * 25;

    // Draw all distance circles.
    for (const r of radii) this.drawCircle(px, py, r.radiusPx);

    // Draw shared bearings: one finite line per bearing, markers at every
    // (circle x bearing) intersection, bearing label at the outermost intersection.
    // We sample the direction via a SHORT geodesic step (1 NM). Sampling over a
    // long distance lets great-circle curvature skew the screen direction —
    // two bearings 180° apart would no longer appear collinear through the place.
    for (const bearing of g.bearings) {
      const trueBrg = magneticToTrue(bearing, g.placeMagVar);
      const farEnd = destinationFromBearingDistance(g.placeLat, g.placeLon, trueBrg, 1);
      this.projection.project({ lat: farEnd.lat, lon: farEnd.lon }, this.outVec);
      const dx = this.outVec[0] - px;
      const dy = this.outVec[1] - py;
      const len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      const ux = dx / len;
      const uy = dy / len;

      this.drawSegmentFromPlaceAlongDirection(px, py, dx, dy, maxRadius + extendPx);
      for (const r of radii) {
        const mx = px + ux * r.radiusPx;
        const my = py + uy * r.radiusPx;
        this.drawFixMarker(mx, my);
      }
      const outerX = px + ux * maxRadius;
      const outerY = py + uy * maxRadius;
      this.drawBearingLabel(outerX, outerY, bearing);
    }

    // Place each fix's ident label at its own (own-radius × own-bearing) intersection
    // so multi-fix groups still tell which dot is which. Direction also sampled
    // over a short distance to avoid great-circle curvature skew.
    for (const r of radii) {
      const ownBrg = magneticToTrue(r.fix.def.radial1Mag, g.placeMagVar);
      const ownFar = destinationFromBearingDistance(g.placeLat, g.placeLon, ownBrg, 1);
      this.projection.project({ lat: ownFar.lat, lon: ownFar.lon }, this.outVec);
      const odx = this.outVec[0] - px;
      const ody = this.outVec[1] - py;
      const olen = Math.hypot(odx, ody);
      if (olen < 0.5) continue;
      const ix = px + (odx / olen) * r.radiusPx;
      const iy = py + (ody / olen) * r.radiusPx;
      this.drawIdent(ix + 14, iy - 8, r.fix.def.ident);
    }
  }

  private drawCircle(cx: number, cy: number, radiusPx: number): void {
    if (radiusPx < 2 || radiusPx > 20000) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLOR_STROKE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws a dashed bearing-line from (px,py) heading along the (dx,dy) direction
   * for `lengthPx` pixels. Used to render finite radial lines that extend the
   * configured number of NM beyond the distance circle (instead of running off
   * to "infinity" pixel-wise).
   */
  private drawSegmentFromPlaceAlongDirection(px: number, py: number, dx: number, dy: number, lengthPx: number): void {
    const len = Math.hypot(dx, dy);
    if (len < 0.5 || lengthPx <= 0) return;
    const ex = px + (dx / len) * lengthPx;
    const ey = py + (dy / len) * lengthPx;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLOR_STROKE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  private drawRadialLine(px: number, py: number, fx: number, fy: number): void {
    // px,py = place (line origin); fx,fy = fix (point at distance NM in bearing direction).
    // Extend the line far past the fix in the bearing direction so it appears to run
    // to infinity (clipped naturally by the canvas).
    const dx = fx - px;
    const dy = fy - py;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const EXTEND_PX = 8000;
    const ex = fx + (dx / len) * EXTEND_PX;
    const ey = fy + (dy / len) * EXTEND_PX;

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLOR_STROKE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.restore();
  }

  private drawFixMarker(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = COLOR_STROKE;
    ctx.fillStyle = COLOR_FILL;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = COLOR_STROKE;
    ctx.arc(x, y, 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
  }

  private drawIdent(x: number, y: number, ident: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    // Measure the label and stagger downward by row height if it would overlap
    // any previously-placed label this frame. Idents share a place/radial when
    // multiple fixes land on the same screen pixel — without staggering they
    // stack on top of each other and become illegible.
    const w = ctx.measureText(ident).width;
    const h = 12;
    const ROW = 14;
    let cy = y;
    const overlaps = (ay: number): boolean => {
      for (const b of this.placedLabelBoxes) {
        // fillText baseline draws ident above (y - h) to y; we treat the box as (x, y - h, w, h).
        if (x < b.x + b.w && x + w > b.x && (ay - h) < b.y + b.h && ay > b.y) return true;
      }
      return false;
    };
    while (overlaps(cy)) cy += ROW;
    this.placedLabelBoxes.push({ x, y: cy - h, w, h });
    ctx.fillStyle = COLOR_TEXT;
    ctx.strokeStyle = COLOR_TEXT_HALO;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(ident, x, cy);
    ctx.fillText(ident, x, cy);
    ctx.restore();
  }

  private drawBearingLabel(x: number, y: number, bearingDeg: number): void {
    const ctx = this.ctx;
    // The degree symbol does not render in MSFS Coherent's font subset.
    // Use a plain ASCII fallback so the label stays legible.
    const text = `${Math.round(bearingDeg).toString().padStart(3, '0')}'`;
    ctx.save();
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = COLOR_TEXT;
    ctx.strokeStyle = COLOR_TEXT_HALO;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    // Offset below-right of the marker, slightly further out than the ident
    const tx = x + 14;
    const ty = y + 14;
    ctx.strokeText(text, tx, ty);
    ctx.fillText(text, tx, ty);
    ctx.restore();
  }
}
