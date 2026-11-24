import React, { useEffect, useMemo, useRef } from 'react';
import { LAND_DOTS } from '../../data/landDots';

interface GlobeCanvasProps {
  /** Ref holding current horizon glow edge `e` and heroHeight from parent scroll loop */
  stateRef: React.MutableRefObject<{
    edge: number;
    heroHeight: number;
    uv: number;
    mPort: boolean;
    reducedMotion: boolean;
    startTime: number;
    recOverrideTime?: number | null;
  }>;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface CityPin {
  name: string;
  vec: Vec3;
}

function toVec3(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const clat = Math.cos(lat);
  return {
    x: clat * Math.sin(lon),
    y: Math.sin(lat),
    z: clat * Math.cos(lon),
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function rotatePoint(p: Vec3, viewLonRad: number, tiltRad: number): Vec3 {
  const cosL = Math.cos(viewLonRad);
  const sinL = Math.sin(viewLonRad);
  const x1 = p.x * cosL - p.z * sinL;
  const z1 = p.x * sinL + p.z * cosL;
  const y1 = p.y;

  const cosT = Math.cos(tiltRad);
  const sinT = Math.sin(tiltRad);
  const y2 = y1 * cosT - z1 * sinT;
  const z2 = y1 * sinT + z1 * cosT;
  return { x: x1, y: y2, z: z2 };
}

const CITIES: CityPin[] = [
  { name: 'МОСКВА', vec: toVec3(55.75, 37.62) },
  { name: 'КРАСНОДАР', vec: toVec3(45.04, 38.98) },
  { name: 'НОВОСИБИРСК', vec: toVec3(55.01, 82.93) },
];

const ARC_PAIRS: [number, number][] = [
  [0, 2], // Москва -> Новосибирск
  [0, 1], // Москва -> Краснодар
  [1, 2], // Краснодар -> Новосибирск
];

export const GlobeCanvas: React.FC<GlobeCanvasProps> = ({ stateRef }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const dotVectors = useMemo(() => {
    const out: Vec3[] = [];
    for (let i = 0; i + 1 < LAND_DOTS.length; i += 2) {
      const lonDeg = LAND_DOTS[i] / 10;
      const latDeg = LAND_DOTS[i + 1] / 10;
      out.push(toVec3(latDeg, lonDeg));
    }
    return out;
  }, []);

  const precomputedArcs = useMemo(() => {
    const STEPS = 56;
    return ARC_PAIRS.map(([aIdx, bIdx]) => {
      const a = CITIES[aIdx].vec;
      const b = CITIES[bIdx].vec;
      const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
      const omega = Math.acos(dot);
      const sinOmega = Math.sin(omega) || 1e-6;
      const pts: Vec3[] = [];
      for (let i = 0; i <= STEPS; i++) {
        const f = i / STEPS;
        const s0 = Math.sin((1 - f) * omega) / sinOmega;
        const s1 = Math.sin(f * omega) / sinOmega;
        const lift = 1 + (0.07 + 0.42 * (omega / Math.PI)) * Math.sin(Math.PI * f);
        pts.push({
          x: (s0 * a.x + s1 * b.x) * lift,
          y: (s0 * a.y + s1 * b.y) * lift,
          z: (s0 * a.z + s1 * b.z) * lift,
        });
      }
      return pts;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const TILT_RAD = (9 * Math.PI) / 180;
    const LON0_DEG = 36;

    const draw = (nowMs: number) => {
      const st = stateRef.current;
      const e = st.edge;

      const box = canvas.parentElement;
      if (!box) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      const cssW = box.clientWidth || window.innerWidth;
      const cssH = box.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      if (e < -0.1) {
        if (!st.reducedMotion) {
          rafId = requestAnimationFrame(draw);
        }
        return;
      }

      const elapsedSec =
        st.recOverrideTime != null
          ? st.recOverrideTime
          : st.reducedMotion
          ? 10
          : Math.max(0, (nowMs - st.startTime) / 1000);

      const introFade = st.reducedMotion
        ? 1
        : 1 - Math.pow(1 - clamp01(elapsedSec / 1.1), 3);
      const scrollFade = 0.45 + 0.55 * clamp01(e / 0.7);
      const globalAlpha = introFade * scrollFade;

      if (globalAlpha <= 0.002) {
        if (!st.reducedMotion) rafId = requestAnimationFrame(draw);
        return;
      }

      const vw = document.documentElement.clientWidth || cssW;
      const isPortrait = st.mPort;

      let unitScale: number;
      let originX: number;
      let originY: number;
      if (isPortrait) {
        unitScale = (1.25 * vw) / 800;
        originX = vw - 1440 * unitScale;
        originY = 16 - 130 * unitScale;
      } else {
        const heroH = st.heroHeight || cssH;
        unitScale = Math.max(vw / 1440, heroH / 900);
        originX = vw - 1440 * unitScale;
        originY = Math.min(0, (heroH - 900 * unitScale) / 2);
      }

      const cx = originX + 1166 * unitScale;
      const cy = originY + 530 * unitScale;
      const R = 400 * unitScale;

      const viewLonDeg = st.reducedMotion ? LON0_DEG : LON0_DEG - elapsedSec * 2.4;
      const viewLonRad = (viewLonDeg * Math.PI) / 180;

      ctx.save();
      ctx.globalAlpha = globalAlpha;

      // 1. Haze and rim glow
      const haze = ctx.createRadialGradient(
        cx - 0.05 * R,
        cy + 0.08 * R,
        0.9 * R,
        cx - 0.05 * R,
        cy + 0.08 * R,
        1.5 * R
      );
      haze.addColorStop(0, 'rgba(47, 99, 255, 0.55)');
      haze.addColorStop(0.12, 'rgba(90, 128, 255, 0.32)');
      haze.addColorStop(0.4, 'rgba(169, 188, 255, 0.16)');
      haze.addColorStop(1, 'rgba(238, 242, 255, 0)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, cssW, cssH);

      // 2. Sphere body
      const bodyGrad = ctx.createRadialGradient(
        cx + 0.3 * R,
        cy - 0.42 * R,
        0.05 * R,
        cx + 0.1 * R,
        cy - 0.15 * R,
        1.25 * R
      );
      bodyGrad.addColorStop(0, '#ffffff');
      bodyGrad.addColorStop(0.55, '#f6f8ff');
      bodyGrad.addColorStop(0.85, '#e8eeff');
      bodyGrad.addColorStop(1, '#d5dfff');

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();

      // 3 & 4. Inner shading + land dots clipped to sphere
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      const innerLimb = ctx.createRadialGradient(cx, cy, 0.8 * R, cx, cy, R);
      innerLimb.addColorStop(0, 'rgba(47, 99, 255, 0)');
      innerLimb.addColorStop(0.75, 'rgba(47, 99, 255, 0.10)');
      innerLimb.addColorStop(1, 'rgba(47, 99, 255, 0.42)');
      ctx.fillStyle = innerLimb;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      const diagShade = ctx.createLinearGradient(
        cx - 0.8 * R,
        cy + 0.8 * R,
        cx + 0.2 * R,
        cy - 0.2 * R
      );
      diagShade.addColorStop(0, 'rgba(47, 99, 255, 0.30)');
      diagShade.addColorStop(1, 'rgba(47, 99, 255, 0)');
      ctx.fillStyle = diagShade;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // 4. Land dots in 5 depth buckets
      const buckets: { x: number; y: number; r: number }[][] = [[], [], [], [], []];
      const baseDotR = Math.max(0.9, 1.75 * unitScale);

      for (let i = 0; i < dotVectors.length; i++) {
        const rp = rotatePoint(dotVectors[i], viewLonRad, TILT_RAD);
        if (rp.z <= 0.02) continue;
        const bIdx = Math.min(4, Math.floor(rp.z * 5.5));
        const dotR = baseDotR * (0.5 + 0.5 * Math.sqrt(rp.z));
        buckets[bIdx].push({
          x: cx + R * rp.x,
          y: cy - R * rp.y,
          r: dotR,
        });
      }

      for (let b = 0; b < 5; b++) {
        const list = buckets[b];
        if (list.length === 0) continue;
        ctx.save();
        ctx.globalAlpha = globalAlpha * (0.22 + b * 0.19);
        ctx.fillStyle = '#111111';
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const d = list[i];
          ctx.moveTo(d.x + d.r, d.y);
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.restore();
      }

      ctx.restore(); // end sphere clip

      // 5. Rim + Highlight arc
      const rimWidth = Math.max(1, 1.4 * unitScale);
      ctx.lineWidth = rimWidth;
      ctx.strokeStyle = 'rgba(47, 99, 255, 0.38)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, R - 0.8), -2.4, -0.3);
      ctx.stroke();

      // 6. Route arcs
      ctx.lineWidth = Math.max(1, 1.15 * unitScale);
      for (let aIdx = 0; aIdx < precomputedArcs.length; aIdx++) {
        const pts = precomputedArcs[aIdx];
        const arcProg = st.reducedMotion
          ? 1
          : clamp01((elapsedSec - (1.0 + aIdx * 0.18)) / 1.1);
        if (arcProg <= 0) continue;

        const maxIndex = Math.floor(arcProg * (pts.length - 1));
        if (maxIndex < 1) continue;

        ctx.save();
        ctx.globalAlpha = globalAlpha * 0.8;
        ctx.strokeStyle = '#2f63ff';
        ctx.beginPath();

        let drawing = false;
        for (let i = 0; i <= maxIndex; i++) {
          const rp = rotatePoint(pts[i], viewLonRad, TILT_RAD);
          const visible = rp.z > 0 || rp.x * rp.x + rp.y * rp.y > 1;
          const sx = cx + R * rp.x;
          const sy = cy - R * rp.y;
          if (visible) {
            if (!drawing) {
              ctx.moveTo(sx, sy);
              drawing = true;
            } else {
              ctx.lineTo(sx, sy);
            }
          } else {
            drawing = false;
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // 7. City pins and labels
      const pinR = Math.max(3, 4.6 * unitScale);
      const labelSize = isPortrait ? Math.max(9.5, 12.5 * unitScale) : 12.5 * unitScale;
      ctx.font = `500 ${labelSize.toFixed(2)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      for (let i = 0; i < CITIES.length; i++) {
        const pinProg = st.reducedMotion
          ? 1
          : clamp01((elapsedSec - (0.8 + i * 0.16)) / 0.6);
        if (pinProg <= 0) continue;

        const rp = rotatePoint(CITIES[i].vec, viewLonRad, TILT_RAD);
        if (rp.z <= 0) continue;
        const limbAlpha = clamp01(rp.z * 5) * pinProg;
        if (limbAlpha <= 0.01) continue;

        const sx = cx + R * rp.x;
        const sy = cy - R * rp.y;

        ctx.save();
        ctx.globalAlpha = globalAlpha * limbAlpha;

        ctx.beginPath();
        ctx.arc(sx, sy, pinR, 0, Math.PI * 2);
        ctx.fillStyle = '#2f63ff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        ctx.fillStyle = '#111111';
        ctx.fillText(CITIES[i].name, sx, sy - (pinR + 0.55 * labelSize));
        ctx.restore();
      }

      ctx.restore();

      if (!st.reducedMotion) {
        rafId = requestAnimationFrame(draw);
      }
    };

    if (stateRef.current.reducedMotion) {
      draw(performance.now());
    } else {
      rafId = requestAnimationFrame(draw);
    }

    const onResize = () => {
      if (stateRef.current.reducedMotion) {
        draw(performance.now());
      }
    };
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
    };
  }, [dotVectors, precomputedArcs, stateRef]);

  return <canvas id="globe" ref={canvasRef} className="kv-globe-canvas" aria-hidden="true" />;
};
