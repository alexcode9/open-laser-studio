export const MM_PER_INCH = 25.4;
export const CSS_PX_PER_MM = 96 / MM_PER_INCH;

export function formatMm(v: number, digits = 2): string {
  return `${v.toFixed(digits)} mm`;
}

export function formatDeg(v: number, digits = 2): string {
  return `${v.toFixed(digits)}°`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return m > 0 ? `${m}m ${rem.toFixed(0).padStart(2, '0')}s` : `${rem.toFixed(1)}s`;
}

/**
 * Calibration helper: corrected steps/unit from a commanded vs measured move
 * (`new = old * commanded / measured`).
 */
export function correctedStepsPerUnit(currentStepsPerUnit: number, commanded: number, measured: number): number {
  if (!(measured !== 0) || !Number.isFinite(measured) || !Number.isFinite(commanded)) return NaN;
  return (currentStepsPerUnit * commanded) / measured;
}

export function rotaryStepsPerDeg(motorStepsPerRev: number, microsteps: number, gearRatio: number): number {
  return (motorStepsPerRev * microsteps * gearRatio) / 360;
}

export function linearStepsPerMm(motorStepsPerRev: number, microsteps: number, gearRatio: number, pitchMm: number): number {
  return (motorStepsPerRev * microsteps * gearRatio) / pitchMm;
}
