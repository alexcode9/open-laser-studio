import type { AxisCandidate, CadEdgeInfo, CadFaceInfo, CadFeatureReport, CircularFeature, CylinderFeature, Vec3 } from '@ols/shared-types';

import { add, dot, normalize, parallel, pointLineDistance, round, scale, sub } from './vec';

/** Geometric tolerances used to relate analytical features. */
export const FEATURE_TOL = {
  /** Axis directions are parallel within this angle (rad). */
  angleRad: 1e-6,
  /** Axes are coincident when the distance between them is below this (mm). */
  axisDistMm: 1e-4,
  /** Radii are equal when they differ by less than this (mm). */
  radiusMm: 1e-5,
  /** Axial ranges touch when the gap is below this (mm). */
  gapMm: 1e-4,
};

const TWO_PI = 2 * Math.PI;

/** Flip a direction so its first significant component is positive (deterministic). */
export function canonicalDirection(d: Vec3): { dir: Vec3; flipped: boolean } {
  for (const c of d) {
    if (Math.abs(c) > 1e-9) return c < 0 ? { dir: [-d[0], -d[1], -d[2]], flipped: true } : { dir: [...d] as Vec3, flipped: false };
  }
  return { dir: [...d] as Vec3, flipped: false };
}

/** Axial interval of a cylindrical face measured along (o, d). */
function axialRange(f: CadFaceInfo, o: Vec3, d: Vec3): [number, number] {
  const c = f.cylinder!;
  const a = add(c.axisOrigin, scale(c.axisDirection, c.axialMinMm));
  const b = add(c.axisOrigin, scale(c.axisDirection, c.axialMaxMm));
  const ta = dot(sub(a, o), d);
  const tb = dot(sub(b, o), d);
  return [Math.min(ta, tb), Math.max(ta, tb)];
}

function sameLine(o1: Vec3, d1: Vec3, o2: Vec3, d2: Vec3): boolean {
  return parallel(d1, d2, FEATURE_TOL.angleRad * 10) && pointLineDistance(o2, o1, d1) < FEATURE_TOL.axisDistMm;
}

/**
 * Group faces of the same underlying cylinder (coaxial, equal radius, same side, contiguous
 * axial range) into features. Faces on the same axis with a gap stay separate features but
 * are reported as grouping suggestions.
 */
export function detectCylinders(faces: CadFaceInfo[]): { cylinders: CylinderFeature[]; suggestions: CadFeatureReport['groupingSuggestions'] } {
  const cyl = faces.filter((f) => f.cylinder);
  const used = new Set<number>();
  const out: CylinderFeature[] = [];
  for (const seed of cyl) {
    if (used.has(seed.index)) continue;
    const sc = seed.cylinder!;
    const { dir } = canonicalDirection(sc.axisDirection);
    // Anchor the axis origin at the foot of the perpendicular from the world origin.
    const o = sub(sc.axisOrigin, scale(dir, dot(sc.axisOrigin, dir)));
    const members = [seed];
    used.add(seed.index);
    let [lo, hi] = axialRange(seed, o, dir);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of cyl) {
        if (used.has(f.index) || f.partIndex !== seed.partIndex) continue;
        const c = f.cylinder!;
        if (Math.abs(c.radiusMm - sc.radiusMm) > FEATURE_TOL.radiusMm) continue;
        if (c.inner !== sc.inner) continue;
        if (!sameLine(o, dir, c.axisOrigin, c.axisDirection)) continue;
        const [a, b] = axialRange(f, o, dir);
        if (a > hi + FEATURE_TOL.gapMm || b < lo - FEATURE_TOL.gapMm) continue;
        // Faces covering the same axial band side by side (split seams) or end to end.
        members.push(f);
        used.add(f.index);
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
        grew = true;
      }
    }
    const span = Math.min(TWO_PI, members.reduce((s, f) => s + f.cylinder!.angularSpanRad, 0));
    // When several faces share a band, angular spans add up; when they stack axially, they do not.
    const bandSpan = Math.min(TWO_PI, Math.max(...members.map((f) => f.cylinder!.angularSpanRad)), span);
    const full = span >= TWO_PI - 1e-6 || bandSpan >= TWO_PI - 1e-6;
    out.push({
      id: `cyl-${seed.index}`,
      partIndex: seed.partIndex,
      faceIndices: members.map((f) => f.index).sort((a, b) => a - b),
      radiusMm: sc.radiusMm,
      diameterMm: sc.radiusMm * 2,
      axisOrigin: o,
      axisDirection: dir,
      axialMinMm: lo,
      axialMaxMm: hi,
      lengthMm: hi - lo,
      areaMm2: members.reduce((s, f) => s + f.areaMm2, 0),
      angularSpanRad: full ? TWO_PI : span,
      fullRevolution: full,
      inner: sc.inner,
      quality: members.every((f) => f.quality === 'analytical') ? 'analytical' : members.some((f) => f.quality === 'fitted') ? 'fitted' : 'mesh-derived',
      residualMm: members.find((f) => f.cylinder?.residualMm !== undefined)?.cylinder?.residualMm,
    });
  }
  const suggestions: CadFeatureReport['groupingSuggestions'] = [];
  const seen = new Set<string>();
  for (const a of out) {
    const ids = out
      .filter((b) => b.partIndex === a.partIndex && b.inner === a.inner && Math.abs(b.radiusMm - a.radiusMm) <= FEATURE_TOL.radiusMm && sameLine(a.axisOrigin, a.axisDirection, b.axisOrigin, b.axisDirection))
      .map((b) => b.id);
    const key = ids.join(',');
    if (ids.length > 1 && !seen.has(key)) {
      seen.add(key);
      suggestions.push({ cylinderIds: ids, reason: `coaxial Ø${round(a.diameterMm, 4)} mm segments separated along the axis` });
    }
  }
  return { cylinders: out, suggestions };
}

/** Circle edges bounding a cylinder feature at either axial end. */
function endCircles(f: CylinderFeature, faces: CadFaceInfo[], edges: CadEdgeInfo[]): { lo: CadEdgeInfo[]; hi: CadEdgeInfo[] } {
  const lo: CadEdgeInfo[] = [];
  const hi: CadEdgeInfo[] = [];
  for (const fi of f.faceIndices) {
    for (const ei of faces[fi]!.edgeIndices) {
      const e = edges[ei]!;
      if (!e.circle || !parallel(e.circle.normal, f.axisDirection, 1e-6)) continue;
      if (pointLineDistance(e.circle.center, f.axisOrigin, f.axisDirection) > FEATURE_TOL.axisDistMm) continue;
      const t = dot(sub(e.circle.center, f.axisOrigin), f.axisDirection);
      if (Math.abs(t - f.axialMinMm) < 1e-4) lo.push(e);
      else if (Math.abs(t - f.axialMaxMm) < 1e-4) hi.push(e);
    }
  }
  return { lo, hi };
}

/** An end is open when the adjacent face continues beyond the hole's own boundary (e.g. a plate surface). */
function endIsOpen(ends: CadEdgeInfo[], feature: CylinderFeature, faces: CadFaceInfo[]): boolean {
  if (ends.length === 0) return false;
  const own = new Set(feature.faceIndices);
  const endEdges = new Set(ends.map((e) => e.index));
  for (const e of ends) {
    for (const fi of e.faceIndices) {
      if (own.has(fi)) continue;
      const f = faces[fi]!;
      if (f.kind !== 'plane') return false;
      if (f.edgeIndices.some((x) => !endEdges.has(x))) return true;
    }
  }
  return false;
}

export function detectCircles(cylinders: CylinderFeature[], faces: CadFaceInfo[], edges: CadEdgeInfo[]): CircularFeature[] {
  const out: CircularFeature[] = [];
  const claimed = new Set<number>();
  for (const c of cylinders) {
    if (c.inner !== true || !c.fullRevolution) continue;
    const { lo, hi } = endCircles(c, faces, edges);
    const openLo = endIsOpen(lo, c, faces);
    const openHi = endIsOpen(hi, c, faces);
    for (const e of [...lo, ...hi]) claimed.add(e.index);
    const mid = (c.axialMinMm + c.axialMaxMm) / 2;
    out.push({
      id: `hole-${c.id}`,
      kind: openLo || openHi ? 'hole' : 'bore',
      partIndex: c.partIndex,
      faceIndices: c.faceIndices,
      edgeIndices: [...lo, ...hi].map((e) => e.index),
      center: add(c.axisOrigin, scale(c.axisDirection, mid)),
      axisDirection: c.axisDirection,
      radiusMm: c.radiusMm,
      diameterMm: c.diameterMm,
      quality: 'analytical',
      through: openLo && openHi,
      depthMm: c.lengthMm,
    });
  }
  // Remaining full circles, deduplicated by geometry (seam-split circles appear as one).
  const seen = new Set<string>();
  for (const e of edges) {
    if (!e.circle || claimed.has(e.index)) continue;
    const key = `${e.partIndex}|${e.circle.center.map((v) => round(v, 4))}|${round(e.circle.radiusMm, 5)}`;
    if (seen.has(key)) {
      out.find((f) => f.kind === 'circular-edge' && f.id === `circle-${key}`)?.edgeIndices.push(e.index);
      continue;
    }
    seen.add(key);
    out.push({
      id: `circle-${key}`,
      kind: 'circular-edge',
      partIndex: e.partIndex,
      faceIndices: e.faceIndices,
      edgeIndices: [e.index],
      center: e.circle.center,
      axisDirection: canonicalDirection(normalize(e.circle.normal)).dir,
      radiusMm: e.circle.radiusMm,
      diameterMm: e.circle.radiusMm * 2,
      quality: 'analytical',
    });
  }
  return out;
}

/**
 * Rank candidate rotary axes from analytical cylinders only. Outer (shaft) surfaces weigh more
 * than bores. Never derived from bounding-box proportions.
 */
export function rankAxes(cylinders: CylinderFeature[]): AxisCandidate[] {
  const clusters: { o: Vec3; d: Vec3; members: CylinderFeature[] }[] = [];
  for (const c of cylinders) {
    const hit = clusters.find((k) => sameLine(k.o, k.d, c.axisOrigin, c.axisDirection));
    if (hit) hit.members.push(c);
    else clusters.push({ o: c.axisOrigin, d: c.axisDirection, members: [c] });
  }
  const scored = clusters.map((k, i) => {
    let score = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const m of k.members) {
      const w = m.inner === false ? 1 : m.inner === null ? 0.6 : 0.35;
      score += w * m.areaMm2 * (m.fullRevolution ? 1 : 0.5);
      const [a, b] = [dot(sub(add(m.axisOrigin, scale(m.axisDirection, m.axialMinMm)), k.o), k.d), dot(sub(add(m.axisOrigin, scale(m.axisDirection, m.axialMaxMm)), k.o), k.d)];
      lo = Math.min(lo, a, b);
      hi = Math.max(hi, a, b);
    }
    const outer = k.members.filter((m) => m.inner === false).length;
    const dias = [...new Set(k.members.map((m) => round(m.diameterMm, 3)))].sort((a, b) => b - a);
    return {
      id: `axis-${i}`,
      origin: add(k.o, scale(k.d, lo)),
      direction: k.d,
      cylinderIds: k.members.map((m) => m.id),
      score,
      reason: `${k.members.length} coaxial cylindrical feature(s) (${outer} outer), Ø ${dias.join(' / ')} mm, axial extent ${round(hi - lo, 3)} mm`,
      quality: k.members.every((m) => m.quality === 'analytical') ? ('analytical' as const) : ('fitted' as const),
    };
  });
  const max = Math.max(1e-12, ...scored.map((s) => s.score));
  return scored.map((s) => ({ ...s, score: s.score / max })).sort((a, b) => b.score - a.score);
}

export function analyzeFeatures(faces: CadFaceInfo[], edges: CadEdgeInfo[]): CadFeatureReport {
  const { cylinders, suggestions } = detectCylinders(faces);
  return {
    cylinders,
    circles: detectCircles(cylinders, faces, edges),
    planeFaceIndices: faces.filter((f) => f.kind === 'plane').map((f) => f.index),
    axisCandidates: rankAxes(cylinders),
    groupingSuggestions: suggestions,
  };
}
