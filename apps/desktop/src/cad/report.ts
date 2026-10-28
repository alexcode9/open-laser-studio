// Markdown measurement report. Values stay millimetres internally; display conversion is the same
// as the inspector. The report states quality and that STEP is the ideal CAD model.

import type { Project } from '@ols/shared-types';

import { QUALITY_LABEL, measurementText } from './format';
import { cadOf } from './workpiece';

export function measurementReport(project: Project): string {
  const cad = cadOf(project);
  const unit = cad.displayUnit;
  const precision = cad.displayPrecision;
  const lines = [
    '# CAD measurement report',
    '',
    `Project: ${project.name || '(untitled)'}`,
    `Exported: ${new Date().toISOString()}`,
    '',
    'Values are stored in millimetres and converted for display. Quality: Exact = analytical B-Rep; Computed = numerical evaluation on exact geometry; Mesh = triangle-derived; Fitted = least-squares to samples with a residual. The ideal STEP geometry is not the manufactured part and does not include machining tolerance.',
    '',
    '## Models',
  ];
  if (cad.models.length === 0) lines.push('(none)');
  for (const m of cad.models) {
    const units = m.unitsConfirmed ? m.declaredUnit : `${m.declaredUnit} (unconfirmed)`;
    lines.push(`- ${m.name} (\`${m.fileName}\`) ${m.sourceType.toUpperCase()}, ${units}, ×${m.unitScaleToMm} to mm, sha256 ${m.sha256.slice(0, 12)}…`);
  }
  lines.push('', '## Measurements');
  if (cad.measurements.length === 0) lines.push('(none)');
  for (const x of cad.measurements) {
    const stale = x.stale ? ' **stale**' : '';
    const residual = typeof x.details.residualMm === 'number' ? `, residual ${x.details.residualMm.toFixed(4)} mm` : '';
    lines.push(`- ${x.label}: ${measurementText(x, unit, precision)} (${QUALITY_LABEL[x.quality]}${residual})${stale}`);
  }
  if (cad.activeWorkpiece) {
    const w = cad.activeWorkpiece;
    lines.push(
      '',
      '## Rotary workpiece',
      `- Ø ${w.diameterMm.toFixed(3)} mm, axial ${w.axialMinMm.toFixed(3)} … ${w.axialMaxMm.toFixed(3)} mm, seam ${w.seamAngleDeg.toFixed(2)}°${w.reversed ? ', reversed' : ''}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
