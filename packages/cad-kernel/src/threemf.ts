// 3MF import. The format is a ZIP of XML; units are declared on the model. Coordinates are
// converted to millimetres here so the rest of the kernel never sees source units. External
// relationships and print tickets are ignored.

import { inflateRawSync } from 'node:zlib';

import type { Mat4, SourceLengthUnit, Vec3 } from '@ols/shared-types';
import { UNIT_TO_MM } from '@ols/shared-types';

import type { RawMesh } from './mesh';
import { IDENTITY, transformPoint } from './vec';

const MF_UNITS: Record<string, SourceLengthUnit> = {
  micron: 'um',
  micrometer: 'um',
  millimetre: 'mm',
  millimeter: 'mm',
  centimetre: 'cm',
  centimeter: 'cm',
  metre: 'm',
  meter: 'm',
  inch: 'in',
  foot: 'ft',
};

export interface ThreeMfReadResult {
  meshes: RawMesh[];
  declaredUnit: string;
  unitScaleToMm: number;
  unitsConfirmed: boolean;
  warnings: string[];
}

/** CRC-32 (ISO 3309), used by the ZIP writer for fixtures. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Uncompressed ZIP (store method) of `path -> bytes`. Enough for 3MF fixtures. */
export function zipStore(files: Record<string, Uint8Array | string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const data = typeof body === 'string' ? encoder.encode(body) : body;
    const n = encoder.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + n.length + data.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(data, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    central.set(n, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((s, x) => s + x.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, locals.length, true);
  ev.setUint16(10, locals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let o = 0;
  for (const p of locals) {
    out.set(p, o);
    o += p.length;
  }
  for (const p of centrals) {
    out.set(p, o);
    o += p.length;
  }
  out.set(eocd, o);
  return out;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function unzip(bytes: Uint8Array): ZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let i = 0;
  while (i + 30 <= bytes.length) {
    const sig = dv.getUint32(i, true);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) throw Object.assign(new Error('not a ZIP/3MF archive'), { code: 'PARSE' });
    const method = dv.getUint16(i + 8, true);
    const comp = dv.getUint32(i + 18, true);
    const uncomp = dv.getUint32(i + 22, true);
    const nameLen = dv.getUint16(i + 26, true);
    const extra = dv.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const start = i + 30 + nameLen + extra;
    const packed = bytes.subarray(start, start + comp);
    let data: Uint8Array;
    if (method === 0) data = packed;
    else if (method === 8) data = new Uint8Array(inflateRawSync(packed));
    else throw Object.assign(new Error(`3MF uses unsupported ZIP compression ${method}`), { code: 'PARSE' });
    if (uncomp && data.length !== uncomp) throw Object.assign(new Error('3MF ZIP entry is corrupt'), { code: 'PARSE' });
    entries.push({ name: name.replace(/\\/g, '/'), data });
    i = start + comp;
  }
  if (entries.length === 0) throw Object.assign(new Error('3MF archive is empty'), { code: 'PARSE' });
  return entries;
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1];
}

function parseTransform(s: string | undefined): Mat4 {
  if (!s) return [...IDENTITY];
  const n = s.trim().split(/[\s,]+/).map(Number);
  if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return [...IDENTITY];
  // 3MF: a b c d e f g h i tx ty tz → columns (a,b,c), (d,e,f), (g,h,i), (tx,ty,tz).
  return [n[0]!, n[1]!, n[2]!, 0, n[3]!, n[4]!, n[5]!, 0, n[6]!, n[7]!, n[8]!, 0, n[9]!, n[10]!, n[11]!, 1];
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const m: number[] = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) m[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return m as unknown as Mat4;
}

interface ObjectDef {
  id: string;
  name: string;
  vertices: Vec3[];
  triangles: [number, number, number][];
  components: { objectId: string; transform: Mat4 }[];
}

function parseModelXml(xml: string): { unit: string; objects: ObjectDef[]; items: { objectId: string; transform: Mat4 }[] } {
  const unit = /<model\b[^>]*\bunit\s*=\s*"([^"]+)"/i.exec(xml)?.[1] ?? '';
  const objects: ObjectDef[] = [];
  const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let om: RegExpExecArray | null;
  while ((om = objectRe.exec(xml))) {
    const head = om[1] ?? '';
    const body = om[2] ?? '';
    const id = attr(head, 'id') ?? String(objects.length + 1);
    const name = attr(head, 'name') ?? `Object ${id}`;
    const vertices: Vec3[] = [];
    const vr = /<vertex\b([^/]*)\/?>/gi;
    let vm: RegExpExecArray | null;
    while ((vm = vr.exec(body))) {
      const t = vm[1] ?? '';
      vertices.push([Number(attr(t, 'x')), Number(attr(t, 'y')), Number(attr(t, 'z'))]);
    }
    const triangles: [number, number, number][] = [];
    const tr = /<triangle\b([^/]*)\/?>/gi;
    let tm: RegExpExecArray | null;
    while ((tm = tr.exec(body))) {
      const t = tm[1] ?? '';
      triangles.push([Number(attr(t, 'v1')), Number(attr(t, 'v2')), Number(attr(t, 'v3'))]);
    }
    const components: ObjectDef['components'] = [];
    const cr = /<component\b([^/]*)\/?>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cr.exec(body))) {
      const t = cm[1] ?? '';
      const oid = attr(t, 'objectid') ?? attr(t, 'objectId');
      if (oid) components.push({ objectId: oid, transform: parseTransform(attr(t, 'transform')) });
    }
    objects.push({ id, name, vertices, triangles, components });
  }
  const items: { objectId: string; transform: Mat4 }[] = [];
  const ir = /<item\b([^/]*)\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = ir.exec(xml))) {
    const t = im[1] ?? '';
    const oid = attr(t, 'objectid') ?? attr(t, 'objectId');
    if (oid) items.push({ objectId: oid, transform: parseTransform(attr(t, 'transform')) });
  }
  return { unit, objects, items };
}

function emit(obj: ObjectDef, byId: Map<string, ObjectDef>, transform: Mat4, into: RawMesh[], depth: number, warnings: string[]): void {
  if (depth > 32) {
    warnings.push(`3MF component nesting deeper than 32 levels was truncated (${obj.name}).`);
    return;
  }
  if (obj.triangles.length > 0) {
    const tris = new Float64Array(obj.triangles.length * 9);
    let o = 0;
    for (const [a, b, c] of obj.triangles) {
      for (const i of [a, b, c]) {
        const p = obj.vertices[i];
        if (!p || p.some((v) => !Number.isFinite(v))) throw Object.assign(new Error(`3MF object "${obj.name}" has an invalid vertex index`), { code: 'PARSE' });
        const q = transformPoint(transform, p);
        tris[o++] = q[0];
        tris[o++] = q[1];
        tris[o++] = q[2];
      }
    }
    into.push({ name: obj.name, triangles: tris });
  }
  for (const c of obj.components) {
    const child = byId.get(c.objectId);
    if (!child) {
      warnings.push(`3MF component references missing object ${c.objectId}.`);
      continue;
    }
    emit(child, byId, mul(transform, c.transform), into, depth + 1, warnings);
  }
}

export function parse3mf(bytes: Uint8Array): ThreeMfReadResult {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Object.assign(new Error('not a 3MF (ZIP) file'), { code: 'PARSE' });
  const files = unzip(bytes);
  const model = files.find((f) => /3dmodel\.model$/i.test(f.name)) ?? files.find((f) => f.name.toLowerCase().endsWith('.model'));
  if (!model) throw Object.assign(new Error('3MF archive has no 3D model part'), { code: 'PARSE' });
  const xml = new TextDecoder().decode(model.data);
  const parsed = parseModelXml(xml);
  const warnings: string[] = [];
  const key = parsed.unit.trim().toLowerCase();
  const source = MF_UNITS[key];
  const unitsConfirmed = !!source;
  const declaredUnit = parsed.unit || 'unspecified';
  const unitScaleToMm = source ? UNIT_TO_MM[source] : 1;
  if (!source) warnings.push(parsed.unit ? `Unknown 3MF unit "${parsed.unit}"; coordinates were read as millimetres.` : '3MF model declares no unit; millimetres were assumed.');
  const byId = new Map(parsed.objects.map((o) => [o.id, o]));
  const meshes: RawMesh[] = [];
  const roots = parsed.items.length > 0 ? parsed.items : parsed.objects.map((o) => ({ objectId: o.id, transform: [...IDENTITY] as Mat4 }));
  for (const item of roots) {
    const obj = byId.get(item.objectId);
    if (!obj) {
      warnings.push(`3MF build item references missing object ${item.objectId}.`);
      continue;
    }
    emit(obj, byId, item.transform, meshes, 0, warnings);
  }
  if (meshes.length === 0) throw Object.assign(new Error('3MF file contains no triangle mesh'), { code: 'PARSE' });
  return { meshes, declaredUnit: declaredUnit || 'unspecified', unitScaleToMm, unitsConfirmed, warnings };
}

/** Cube of side `size` in file units, for fixtures. */
export function cube3mf(size: number, unit: 'millimeter' | 'inch', name = 'Cube'): Uint8Array {
  const s = size;
  const verts = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ];
  const tris = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [1, 5, 6],
    [1, 6, 2],
    [2, 6, 7],
    [2, 7, 3],
    [3, 7, 4],
    [3, 4, 0],
  ];
  const vertexXml = verts.map((v) => `        <vertex x="${v[0]}" y="${v[1]}" z="${v[2]}" />`).join('\n');
  const triXml = tris.map((t) => `        <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />`).join('\n');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" name="${name}" type="model">
      <mesh>
        <vertices>
${vertexXml}
        </vertices>
        <triangles>
${triXml}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>
`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>
`;
  return zipStore({
    '[Content_Types].xml': types,
    '_rels/.rels': rels,
    '3D/3dmodel.model': model,
  });
}
