// "Use CAD model as workpiece": pure project transformations. Rust computes the alignment
// (cad:alignToRotary); this module only decides which cylinder to use and records the result.
// Machine calibration (angular/axial zero, the machine profile) is never modified here.

import type { CadAlignParams, CadAlignResult, CadModelData, CadModelRef, CadWorkpieceBinding, CadWorkspace, CylinderFeature, Project } from '@ols/shared-types';

export const IDENTITY_MAT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Limits of the cylinder workpiece spec (see CylinderSpecSchema). */
export const MAX_WORKPIECE_DIAMETER_MM = 1000;
export const MAX_WORKPIECE_LENGTH_MM = 5000;

export function emptyCadWorkspace(): CadWorkspace {
  return { models: [], measurements: [], activeWorkpiece: null, displayUnit: 'mm', displayPrecision: 3 };
}

export function cadOf(p: Project): CadWorkspace {
  return p.cad ?? emptyCadWorkspace();
}

export interface RankedCylinder {
  feature: CylinderFeature;
  score: number;
  reason: string;
  /** Usable as a rotary workpiece (outer, full revolution, within machine spec limits). */
  usable: boolean;
  problem: string | null;
}

/**
 * Cylinders ordered by suitability as the rotary workpiece. The ranking uses the kernel's axis
 * candidates (outer surfaces and long coaxial extents score higher); the longest bounding-box side
 * is never assumed to be the axis.
 */
export function rankCylinders(model: CadModelData): RankedCylinder[] {
  const byId = new Map(model.features.axisCandidates.flatMap((a) => a.cylinderIds.map((id) => [id, a] as const)));
  return model.features.cylinders
    .map((feature): RankedCylinder => {
      const axis = byId.get(feature.id);
      let problem: string | null = null;
      if (feature.inner === true) problem = 'Inner surface (bore/hole)';
      else if (!feature.fullRevolution) problem = 'Partial cylinder';
      else if (feature.diameterMm > MAX_WORKPIECE_DIAMETER_MM) problem = `Diameter above ${MAX_WORKPIECE_DIAMETER_MM} mm`;
      else if (feature.lengthMm > MAX_WORKPIECE_LENGTH_MM) problem = `Length above ${MAX_WORKPIECE_LENGTH_MM} mm`;
      const outer = feature.inner === false ? 1 : feature.inner === null ? 0.6 : 0.35;
      return {
        feature,
        score: (axis?.score ?? 0) * 1000 + outer * feature.areaMm2,
        reason: axis?.reason ?? '',
        usable: problem === null,
        problem,
      };
    })
    .sort((a, b) => Number(b.usable) - Number(a.usable) || b.score - a.score);
}

export function cylinderForFace(model: CadModelData, face: number): CylinderFeature | null {
  return model.features.cylinders.find((c) => c.faceIndices.includes(face)) ?? null;
}

export function alignParamsFor(c: CylinderFeature, seamAngleDeg: number, reversed: boolean): CadAlignParams {
  return {
    axisOrigin: c.axisOrigin,
    axisDirection: c.axisDirection,
    axialMinMm: c.axialMinMm,
    axialMaxMm: c.axialMaxMm,
    seamAngleDeg,
    reversed,
    seamReference: null,
  };
}

export interface WorkpieceChoice {
  model: CadModelData;
  cylinder: CylinderFeature;
  seamAngleDeg: number;
  reversed: boolean;
  alignment: CadAlignResult;
}

/** The project after binding the workpiece to a CAD cylinder. One undo step. */
export function applyWorkpiece(p: Project, choice: WorkpieceChoice): Project {
  const { model, cylinder: c, alignment } = choice;
  if (c.diameterMm > MAX_WORKPIECE_DIAMETER_MM || c.lengthMm > MAX_WORKPIECE_LENGTH_MM) throw new Error('cylinder exceeds the workpiece limits');
  const cad = cadOf(p);
  if (!cad.models.some((m) => m.id === model.modelId)) throw new Error('model is not part of the project');
  const binding: CadWorkpieceBinding = {
    modelId: model.modelId,
    cylinderId: c.id,
    faces: c.faceIndices.map((f) => ({
      modelId: model.modelId,
      geometryRevision: model.geometryRevision,
      kind: 'face',
      index: f,
      point: null,
      onFace: null,
      signature: model.faces[f]?.signature ?? null,
    })),
    diameterMm: c.diameterMm,
    axialMinMm: c.axialMinMm,
    axialMaxMm: c.axialMaxMm,
    axisOrigin: c.axisOrigin,
    axisDirection: c.axisDirection,
    seamAngleDeg: choice.seamAngleDeg,
    reversed: choice.reversed,
    modelToWorkpiece: alignment.modelToWorkpiece,
  };
  return {
    ...p,
    mode: 'cylinder',
    workpiece: { ...p.workpiece, diameterMm: c.diameterMm, lengthMm: alignment.lengthMm },
    cad: {
      ...cad,
      models: cad.models.map((m) => (m.id === model.modelId ? { ...m, modelToWorkpiece: alignment.modelToWorkpiece } : { ...m, modelToWorkpiece: IDENTITY_MAT4 })),
      activeWorkpiece: binding,
    },
  };
}

/** Detach the CAD model from the workpiece. The cylinder spec keeps its values. */
export function clearWorkpiece(p: Project): Project {
  const cad = cadOf(p);
  if (!cad.activeWorkpiece) return p;
  return { ...p, cad: { ...cad, activeWorkpiece: null, models: cad.models.map((m) => ({ ...m, modelToWorkpiece: IDENTITY_MAT4 })) } };
}

export function modelRefFor(d: CadModelData): CadModelRef {
  return {
    id: d.modelId,
    name: d.name,
    fileName: d.fileName,
    sourceType: d.sourceType,
    declaredUnit: d.declaredUnit,
    unitScaleToMm: d.unitScaleToMm,
    unitsConfirmed: d.unitsConfirmed,
    sha256: d.sha256,
    byteLength: d.byteLength,
    assetPath: '',
    geometryRevision: d.geometryRevision,
    kernelVersion: d.kernelVersion,
    deflectionMm: d.deflectionMm,
    sourceToModel: d.sourceToModel,
    modelToWorkpiece: IDENTITY_MAT4,
    hiddenParts: [],
  };
}
