'use client';

import React, { useMemo, useState } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
  DragEndEvent,
} from '@dnd-kit/core';
import { VegaLite } from 'react-vega';

type Row = Record<string, any>;

type EncodingSlots = {
  x?: string;
  y: string[];          // 👈 multiple measures supported
  color?: string;
  size?: string;
  row?: string;
  column?: string;
};

type Field = { name: string; type: 'quantitative' | 'temporal' | 'nominal' | 'ordinal' };

// ---------- utils ----------


function inferType(values: any[]): Field['type'] {
  const sample = values.find((v) => v !== null && v !== undefined);
  if (sample instanceof Date) return 'temporal';
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return 'temporal';
    return 'nominal';
  }
  if (typeof sample === 'number') return 'quantitative';
  return 'nominal';
}

function buildCatalog(rows: Row[]): Field[] {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((k) => ({ name: k, type: inferType(rows.map((r) => r[k])) }));
}

function recommendedMark(enc: EncodingSlots, fields: Field[]) {
  const typeOf = (n?: string) => fields.find((f) => f.name === n)?.type;
  const x = typeOf(enc.x);
  // If multiple measures -> lines by default
  if (enc.y.length > 1) return 'line';
  const y = typeOf(enc.y[0]);
  if (x === 'temporal' && y === 'quantitative') return 'line';
  if (x === 'nominal' && y === 'quantitative') return 'bar';
  if (x === 'quantitative' && y === 'quantitative') return 'point';
  return 'bar';
}

// chip colors (dimension vs measure)
function chipColors(kind: 'dimension' | 'measure') {
  return kind === 'dimension'
    ? { bg: '#ffecb3', border: '#fbc02d', text: '#5d4037' } // amber
    : { bg: '#c8e6c9', border: '#388e3c', text: '#1b5e20' }; // green
}

// ---------- UI atoms ----------
function FieldChip({
  name,
  bg,
  border,
  text,
  onClear,
  dragging,
}: {
  name: string;
  bg: string;
  border: string;
  text: string;
  dragging?: boolean;
  onClear?: () => void;
}) {
  return (
    <div
      className="field-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        border: '1px solid #d0d7de',
        background: dragging ? '#23293a' : '#23293a',
        boxShadow: dragging ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
        margin: 4,
        cursor: 'grab',
        userSelect: 'none',
        fontSize: 12,
        touchAction: 'none',
      }}
    >
      {name}
      {onClear && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          style={{
            cursor: 'pointer',
            border: 'none',
            background: 'transparent',
            width: 18,
            height: 18,
            lineHeight: '18px',
            textAlign: 'center',
            borderRadius: 999,
            color: text,
            opacity: 0.7,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function DraggableField({
  name,
  kind,
}: {
  name: string;
  kind: 'dimension' | 'measure';
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: name });
  const c = chipColors(kind);
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ display: 'inline-block' }}>
      <FieldChip name={name} bg={c.bg} border={c.border} text={c.text} />
    </div>
  );
}

function DropZone({
  id,
  label,
  children,
}: React.PropsWithChildren<{ id: keyof EncodingSlots; label: string }>) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 56,
        padding: 8,
        border: `2px dashed ${isOver ? '#1f6feb' : '#d0d7de'}`,
        borderRadius: 10,
        background: isOver ? 'rgba(31,111,235,0.06)' : 'transparent',
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div style={{ fontSize: 11, color: '#57606a', marginBottom: 4 }}>{label}</div>
      {children}
      {!children && <div style={{ fontSize: 12, color: '#8c959f' }}>Drop a field here</div>}
    </div>
  );
}

// ---------- main ----------
export default function ChartBuilder({ rows }: { rows: Row[] }) {
  const fields = useMemo(() => buildCatalog(rows), [rows]);
  const dimensions = fields.filter((f) => f.type !== 'quantitative');
  const measures = fields.filter((f) => f.type === 'quantitative');

  const [enc, setEnc] = useState<EncodingSlots>({ y: [] });
  const [explicitMark, setExplicitMark] = useState<string | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);

  // helpers
  function clearSlot(slot: Exclude<keyof EncodingSlots, 'y'>) {
    setEnc((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }
  function removeY(name: string) {
    setEnc((prev) => ({ ...prev, y: prev.y.filter((m) => m !== name) }));
  }

  function onDragEnd(e: DragEndEvent) {
    const field = e.active?.id as string | undefined;
    const slot = e.over?.id as keyof EncodingSlots | undefined;
    setActiveId(null);
    if (!field || !slot) return;

    setEnc((prev) => {
      // Only Y accepts multiple
      if (slot === 'y') {
        if (prev.y.includes(field)) return prev;
        return { ...prev, y: [...prev.y, field] };
      }
      // Single-slot panels replace
      return { ...prev, [slot]: field };
    });
  }

  const mark = explicitMark ?? recommendedMark(enc, fields);

  const spec = useMemo(() => {
    // If multiple measures on Y, fold to long format
    const yMeasures = enc.y ?? [];
    const hasMultiY = yMeasures.length > 1;

    const transforms: any[] = [];
    const encoding: any = {};

    if (hasMultiY) {
      transforms.push({ fold: yMeasures, as: ['series', 'value'] });
    }

    // X
    if (enc.x) {
      const fx = fields.find((f) => f.name === enc.x)!;
      encoding.x = { field: fx.name, type: fx.type };
    }

    // Y
    if (hasMultiY) {
      encoding.y = { field: 'value', type: 'quantitative' };
    } else if (yMeasures.length === 1) {
      const fy = fields.find((f) => f.name === yMeasures[0])!;
      encoding.y = { field: fy.name, type: fy.type };
      if (fy.type === 'quantitative') encoding.y.aggregate = 'sum';
    }

    // Color & series logic
    if (hasMultiY) {
      if (enc.color) {
        // Respect user's color field; separate measures via strokeDash
        const fc = fields.find((f) => f.name === enc.color)!;
        encoding.color = { field: fc.name, type: fc.type };
        encoding.strokeDash = { field: 'series', type: 'nominal' };
        // Tooltips helpful when combining series
        encoding.tooltip = [
          { field: enc.x ?? '', type: enc.x ? fields.find(f => f.name === enc.x)!.type : 'nominal' },
          { field: fc.name, type: fc.type },
          { field: 'series', type: 'nominal' },
          { field: 'value', type: 'quantitative' },
        ].filter((t: any) => t.field);
      } else {
        // No user color -> color by series
        encoding.color = { field: 'series', type: 'nominal' };
      }
    } else if (enc.color) {
      const fc = fields.find((f) => f.name === enc.color)!;
      encoding.color = { field: fc.name, type: fc.type };
    }

    // Size
    if (enc.size) {
      const fs = fields.find((f) => f.name === enc.size)!;
      encoding.size = { field: fs.name, type: fs.type };
    }

    // Facets
    if (enc.row) {
      const fr = fields.find((f) => f.name === enc.row)!;
      encoding.row = { field: fr.name, type: fr.type };
    }
    if (enc.column) {
      const fcol = fields.find((f) => f.name === enc.column)!;
      encoding.column = { field: fcol.name, type: fcol.type };
    }

    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      data: { values: rows },
      transform: transforms,
      mark,
      encoding,
    };
  }, [enc, fields, rows, mark]);

  // Resolve chip color per field (dimension vs measure)
  const chipThemeFor = (name: string) =>
    measures.some((m) => m.name === name) ? chipColors('measure') : chipColors('dimension');

  return (
    <div className="card" style={{ padding: 12, overflow: 'visible', position: 'relative' }}>
      <DndContext
        onDragStart={(e) => setActiveId(e.active?.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          {/* Palette */}
          <section style={{ padding: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Fields</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#57606a', marginBottom: 4 }}>Dimensions</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {dimensions.map((f) => (
                  <DraggableField key={f.name} name={f.name} kind="dimension" />
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, color: '#57606a', marginBottom: 4 }}>Measures</div>
              <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                {measures.map((f) => (
                  <DraggableField key={f.name} name={f.name} kind="measure" />
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, color: '#57606a' }}>Mark</label>
              <select
                className="input"
                value={explicitMark ?? ''}
                onChange={(e) => setExplicitMark(e.target.value || undefined)}
                style={{ display: 'block', marginTop: 4 }}
              >
                <option value="">(auto)</option>
                <option value="bar">Bar</option>
                <option value="line">Line</option>
                <option value="point">Scatter</option>
                <option value="area">Area</option>
                <option value="rect">Heatmap</option>
              </select>
            </div>
          </section>

          {/* Encodings + Chart */}
          <section style={{ padding: 8, borderLeft: '2px solid #23293a',paddingLeft: "20px"}}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Encodings</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <DropZone id="x" label="X">
                {enc.x && (() => {
                  const c = chipThemeFor(enc.x!);
                  return (
                    <FieldChip
                      name={enc.x!}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => clearSlot('x')}
                    />
                  );
                })()}
              </DropZone>

              <DropZone id="y" label="Y (multiple allowed)">
                {enc.y.map((name) => {
                  const c = chipThemeFor(name);
                  return (
                    <FieldChip
                      key={name}
                      name={name}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => removeY(name)}
                    />
                  );
                })}
              </DropZone>

              <DropZone id="color" label="Color">
                {enc.color && (() => {
                  const c = chipThemeFor(enc.color!);
                  return (
                    <FieldChip
                      name={enc.color!}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => clearSlot('color')}
                    />
                  );
                })()}
              </DropZone>

              <DropZone id="size" label="Size">
                {enc.size && (() => {
                  const c = chipThemeFor(enc.size!);
                  return (
                    <FieldChip
                      name={enc.size!}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => clearSlot('size')}
                    />
                  );
                })()}
              </DropZone>

              <DropZone id="row" label="Row Facet">
                {enc.row && (() => {
                  const c = chipThemeFor(enc.row!);
                  return (
                    <FieldChip
                      name={enc.row!}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => clearSlot('row')}
                    />
                  );
                })()}
              </DropZone>

              <DropZone id="column" label="Column Facet">
                {enc.column && (() => {
                  const c = chipThemeFor(enc.column!);
                  return (
                    <FieldChip
                      name={enc.column!}
                      bg={c.bg}
                      border={c.border}
                      text={c.text}
                      onClear={() => clearSlot('column')}
                    />
                  );
                })()}
              </DropZone>
            </div>

            <div style={{ marginTop: 12, borderTop: '1px solid #eaeef2', paddingTop: 12 }}>
              <VegaLite spec={spec as any} actions={false} />
            </div>
          </section>
        </div>

        {/* Floating ghost while dragging: same chip UI */}
        <DragOverlay dropAnimation={null}>
          {activeId ? (() => {
            const c = chipThemeFor(activeId);
            return (
              <div style={{ zIndex: 9999, pointerEvents: 'none' }}>
                <FieldChip name={activeId} bg={c.bg} border={c.border} text={c.text}  dragging/>
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
