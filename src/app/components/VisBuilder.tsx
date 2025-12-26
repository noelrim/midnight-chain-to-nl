'use client';

import { useMemo, useState, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  useDraggable,
  useDroppable,
  useSensors,
  useSensor,
  PointerSensor,
} from '@dnd-kit/core';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';

type Row = Record<string, any>;
type FieldType = 'quantitative' | 'temporal' | 'nominal';
type Encoding = { x?: string; y?: string; color?: string };

function isNumericValue(v: any) {
  if (v == null || v === '') return false;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n);
}
function isTemporalValue(v: any) {
  if (v instanceof Date) return true;
  if (typeof v !== 'string') return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return true;
  return !Number.isNaN(Date.parse(v));
}

// ✅ numeric-first to avoid accidental "temporal"
function inferType(values: any[]): FieldType {
  const sample = values.slice(0, 60).filter(v => v !== null && v !== undefined);
  if (sample.length === 0) return 'nominal';

  const numHits  = sample.filter(isNumericValue).length;
  const timeHits = sample.filter(isTemporalValue).length;

  if (numHits  >= Math.ceil(sample.length * 0.6)) return 'quantitative';
  if (timeHits >= Math.ceil(sample.length * 0.6)) return 'temporal';
  return 'nominal';
}

function useFieldList(rows: Row[]) {
  return useMemo(() => {
    if (!rows?.length) return [] as { name: string; type: FieldType }[];
    const keys = Object.keys(rows[0]);
    return keys.map((k) => ({
      name: k,
      type: inferType(rows.map((r) => r[k])),
    }));
  }, [rows]);
}

function Pill({ f }: { f: { name: string; type: FieldType } }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `field:${f.name}`,
    data: { field: f },
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    cursor: 'grab',
  };
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="badge" style={style}>
      <span style={{ opacity: 0.7, fontSize: 11, textTransform: 'uppercase', marginRight: 6 }}>{f.type}</span>
      <span>{f.name}</span>
    </div>
  );
}

function DropZone({
  id, label, accept, value, onClear,
}: {
  id: string;
  label: string;
  accept: FieldType[];
  value?: string;
  onClear: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div
      className="card"
      ref={setNodeRef}
      style={{
        padding: 10,
        borderStyle: 'dashed',
        borderWidth: 1,
        borderColor: 'var(--border)',
        background: isOver ? 'rgba(110,168,254,.08)' : 'transparent'
      }}
    >
      <div className="toolbar" style={{ marginBottom: 6 }}>
        <span className="badge">{label}</span>
        <span className="note">Accepts: {accept.join(', ')}</span>
        <span className="spacer" />
        {value && <button className="btn ghost" onClick={onClear}>Clear</button>}
      </div>
      {value ? <div className="badge">{value}</div> : <p className="note">Drag a field here</p>}
    </div>
  );
}

export default function VisBuilder({
  rows,
  onSpecChange,
}: {
  rows: Row[];
  onSpecChange: (spec: any | null) => void;
}) {
  const fields = useFieldList(rows);
  const [enc, setEnc] = useState<Encoding>({});

  // ✅ single DnD context for BOTH palette and shelves
  const sensors = useSensors(useSensor(PointerSensor));

  // build a vega‑lite spec whenever enc changes
  const spec = useMemo(() => {
    if (!enc.y || (!enc.x && !enc.color)) return null;

    const fieldTypeMap = new Map(fields.map(f => [f.name, f.type]));
    const xType = enc.x ? (fieldTypeMap.get(enc.x) || 'nominal') : undefined;
    const yType = fieldTypeMap.get(enc.y) || 'quantitative';
    const colorType = enc.color ? (fieldTypeMap.get(enc.color) || 'nominal') : undefined;

    return {
      mark: xType === 'temporal' ? 'line' : 'bar',
      encoding: {
        ...(enc.x ? { x: { field: enc.x, type: xType } } : {}),
        y: { field: enc.y, type: yType },
        ...(enc.color ? { color: { field: enc.color, type: colorType } } : {}),
        tooltip: [
          ...(enc.x ? [{ field: enc.x, type: xType }] : []),
          { field: enc.y, type: yType },
          ...(enc.color ? [{ field: enc.color, type: colorType }] : []),
        ],
      },
    };
  }, [enc, fields]);

  // push to parent (after render)
  useEffect(() => {
    onSpecChange(spec);
  }, [spec, onSpecChange]);

  function onDragEnd(e: DragEndEvent) {
    const fld = e.active?.data?.current?.field as { name: string; type: FieldType } | undefined;
    const overId = e.over?.id as string | undefined;
    if (!fld || !overId) return;

    // simple compatibility: allow anything for now (accept list is informational)
    if (overId === 'drop-x') {
      setEnc((old) => ({ ...old, x: fld.name }));
    } else if (overId === 'drop-y') {
      setEnc((old) => ({ ...old, y: fld.name }));
    } else if (overId === 'drop-color') {
      setEnc((old) => ({ ...old, color: fld.name }));
    }
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1.2fr', gap: 16 }}>
        {/* palette */}
        <section className="card">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <span className="badge">Fields</span>
            <span className="note">Drag to shelves →</span>
          </div>
          <div className="chips" style={{ gap: 8 }}>
            {fields.map((f) => <Pill key={f.name} f={f} />)}
          </div>
        </section>

        {/* shelves */}
        <section className="card">
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <span className="badge">Shelves</span>
            <span className="note">Drop fields to map encodings</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 10 }}>
            <DropZone id="drop-x" label="X (temporal/nominal)" accept={['temporal','nominal','quantitative']} value={enc.x} onClear={() => setEnc(e => ({ ...e, x: undefined }))} />
            <DropZone id="drop-y" label="Y (quantitative)" accept={['quantitative','nominal']} value={enc.y} onClear={() => setEnc(e => ({ ...e, y: undefined }))} />
            <DropZone id="drop-color" label="Color (group)" accept={['nominal','temporal','quantitative']} value={enc.color} onClear={() => setEnc(e => ({ ...e, color: undefined }))} />
          </div>
        </section>
      </div>
    </DndContext>
  );
}
