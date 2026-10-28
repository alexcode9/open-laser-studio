import type { CadMeasurement, DisplayUnit, MeasurementQuality, Vec3 } from '@ols/shared-types';

const PER_MM: Record<DisplayUnit, number> = { mm: 1, cm: 0.1, in: 1 / 25.4 };

export function formatLength(mm: number, unit: DisplayUnit = 'mm', precision = 3): string {
  if (!Number.isFinite(mm)) return '—';
  return `${(mm * PER_MM[unit]).toFixed(precision)} ${unit}`;
}

export function formatArea(mm2: number, unit: DisplayUnit = 'mm', precision = 3): string {
  if (!Number.isFinite(mm2)) return '—';
  return `${(mm2 * PER_MM[unit] ** 2).toFixed(precision)} ${unit}²`;
}

export function formatVolume(mm3: number, unit: DisplayUnit = 'mm', precision = 3): string {
  if (!Number.isFinite(mm3)) return '—';
  return `${(mm3 * PER_MM[unit] ** 3).toFixed(precision)} ${unit}³`;
}

export function formatAngle(deg: number, precision = 3): string {
  return Number.isFinite(deg) ? `${deg.toFixed(precision)}°` : '—';
}

export function formatVec(v: Vec3, unit: DisplayUnit = 'mm', precision = 3): string {
  return `(${v.map((c) => (c * PER_MM[unit]).toFixed(precision)).join(', ')})`;
}

export function formatDir(v: Vec3, precision = 4): string {
  return `(${v.map((c) => (Math.abs(c) < 10 ** -precision ? 0 : c).toFixed(precision)).join(', ')})`;
}

/** Value text of a measurement in display units (radius also shows the diameter). */
export function measurementText(m: CadMeasurement, unit: DisplayUnit, precision: number): string {
  switch (m.unit) {
    case 'deg':
      return formatAngle(m.value, precision);
    case 'mm2':
      return formatArea(m.value, unit, precision);
    default:
      if (m.kind === 'radius') return `R ${formatLength(m.value, unit, precision)} · Ø ${formatLength(m.value * 2, unit, precision)}`;
      if (m.kind === 'diameter') return `Ø ${formatLength(m.value, unit, precision)}`;
      return formatLength(m.value, unit, precision);
  }
}

export const QUALITY_LABEL: Record<MeasurementQuality, string> = {
  analytical: 'Exact',
  computed: 'Computed',
  'mesh-derived': 'Mesh',
  fitted: 'Fitted',
};

export const QUALITY_HELP: Record<MeasurementQuality, string> = {
  analytical: 'Read directly from the exact B-Rep geometry (analytical surface or curve).',
  computed: 'Evaluated numerically by the geometry kernel on the exact geometry, within the stated tolerance.',
  'mesh-derived': 'Computed from triangles. Accuracy depends on the mesh resolution; not suitable for precise dimensions.',
  fitted: 'Ideal feature fitted to mesh samples; see the residual.',
};

export const QUALITY_TONE: Record<MeasurementQuality, 'ok' | 'sim' | 'warn'> = {
  analytical: 'ok',
  computed: 'sim',
  'mesh-derived': 'warn',
  fitted: 'warn',
};

export const QUALITY_MARK: Record<MeasurementQuality, string> = {
  analytical: '',
  computed: '≈',
  'mesh-derived': '~',
  fitted: '~',
};
