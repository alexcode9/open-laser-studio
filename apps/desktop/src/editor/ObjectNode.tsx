import { toSvgPathData } from '@ols/geometry-adapters';
import type { DesignObject, Layer } from '@ols/shared-types';
import type Konva from 'konva';
import { memo, useEffect, useMemo, useState } from 'react';
import { Ellipse, Group, Image as KImage, Line, Path, Rect, Text } from 'react-konva';

const imageCache = new Map<string, HTMLImageElement>();

function useImage(src: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => (src ? (imageCache.get(src) ?? null) : null));
  useEffect(() => {
    if (!src) return;
    const cached = imageCache.get(src);
    if (cached?.complete) {
      setImg(cached);
      return;
    }
    const el = new Image();
    el.onload = () => {
      imageCache.set(src, el);
      setImg(el);
    };
    el.src = src;
  }, [src]);
  return img;
}

interface Props {
  obj: DesignObject;
  layer: Layer;
  asset?: string;
  draggable: boolean;
  selected: boolean;
  onSelect: (id: string, e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}

function hexAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return `rgba(249,115,22,${a})`;
  const n = Number.parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** One design object rendered in design millimetres (the stage carries the zoom). */
export const ObjectNode = memo(function ObjectNode({ obj, layer, asset, draggable, selected, onSelect, onDragEnd, onTransformEnd }: Props) {
  const t = obj.transform;
  const color = layer.color;
  const fillMode = layer.settings.mode === 'fill';
  const common = {
    stroke: color,
    strokeWidth: selected ? 2 : 1.25,
    strokeScaleEnabled: false,
    hitStrokeWidth: 10,
    perfectDrawEnabled: false,
    opacity: layer.output ? 1 : 0.45,
  };
  const closedFill = hexAlpha(color, fillMode ? 0.28 : 0.04);
  const pathData = useMemo(() => {
    if (obj.shape.kind === 'path') return toSvgPathData(obj.shape.commands);
    if (obj.shape.kind === 'text' && obj.shape.outline) return toSvgPathData(obj.shape.outline);
    return null;
  }, [obj.shape]);
  const img = useImage(obj.shape.kind === 'image' ? asset : undefined);

  let body: React.ReactNode = null;
  const s = obj.shape;
  switch (s.kind) {
    case 'rect':
      body = <Rect width={s.width} height={s.height} fill={closedFill} {...common} />;
      break;
    case 'ellipse':
      body = <Ellipse radiusX={s.rx} radiusY={s.ry} fill={closedFill} {...common} />;
      break;
    case 'line':
      body = <Line points={s.points} closed={s.closed} fill={s.closed ? closedFill : undefined} {...common} />;
      break;
    case 'path':
      body = <Path data={pathData ?? ''} fill={closedFill} {...common} />;
      break;
    case 'text':
      body = pathData ? (
        <Path data={pathData} fill={hexAlpha(color, fillMode ? 0.5 : 0.15)} {...common} />
      ) : (
        <Text text={s.text} fontSize={s.fontSizeMm} fontFamily={s.fontFamily} fill={color} opacity={0.6} />
      );
      break;
    case 'image':
      body = (
        <>
          {img && <KImage image={img} width={s.widthMm} height={s.heightMm} opacity={layer.output ? 0.9 : 0.4} />}
          <Rect width={s.widthMm} height={s.heightMm} {...common} dash={[4, 3]} />
        </>
      );
      break;
  }

  return (
    <Group
      id={obj.id}
      name="design-object"
      x={t.x}
      y={t.y}
      rotation={t.rotationDeg}
      scaleX={t.scaleX}
      scaleY={t.scaleY}
      draggable={draggable}
      onMouseDown={(e) => onSelect(obj.id, e)}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
    >
      {body}
    </Group>
  );
});
