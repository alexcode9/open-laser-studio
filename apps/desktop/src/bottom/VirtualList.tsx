import { type ReactNode, useEffect, useRef, useState } from 'react';

/** Fixed-row-height virtual list (G-code listings can have millions of lines). */
export function VirtualList<T>({
  items,
  rowHeight = 16,
  render,
  stickToBottom = false,
  scrollToIndex,
  className,
}: {
  items: readonly T[];
  rowHeight?: number;
  render: (item: T, index: number) => ReactNode;
  stickToBottom?: boolean;
  scrollToIndex?: number | null;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(200);
  const atBottom = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && stickToBottom && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, stickToBottom]);

  useEffect(() => {
    const el = ref.current;
    if (el && scrollToIndex != null && scrollToIndex >= 0) el.scrollTop = Math.max(0, scrollToIndex * rowHeight - height / 2);
  }, [scrollToIndex, rowHeight, height]);

  const first = Math.max(0, Math.floor(scroll / rowHeight) - 10);
  const last = Math.min(items.length, Math.ceil((scroll + height) / rowHeight) + 10);
  const rows: ReactNode[] = [];
  for (let i = first; i < last; i++) {
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowHeight, height: rowHeight, left: 0, right: 0 }}>
        {render(items[i]!, i)}
      </div>,
    );
  }
  return (
    <div
      ref={ref}
      className={className ?? 'relative h-full overflow-auto'}
      onScroll={(e) => {
        const el = e.currentTarget;
        setScroll(el.scrollTop);
        atBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - rowHeight * 2;
      }}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>{rows}</div>
    </div>
  );
}
