'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
  DragEndEvent,
} from '@dnd-kit/core';
import 'chartjs-adapter-date-fns';

// --- Chart.js imports/registration ---
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, TimeScale,
  PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Legend, Filler, Title
} from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Chart as ReactChart } from 'react-chartjs-2';
import { MatrixController, MatrixElement } from 'chartjs-chart-matrix';

ChartJS.register(
  CategoryScale, LinearScale, TimeScale,
  PointElement, LineElement, BarElement, ArcElement,
  Tooltip, Legend, Filler, Title, zoomPlugin,
  MatrixController, MatrixElement
);

// --- Import ALL logic from modules ---
import { Row, Field, EncodingSlots, ChartState } from './types/chart';
import { DataProcessor } from './utils/DataProcessor';
import { TimeHierarchy } from './utils/TimeHierarchy';
import { ChartConfigBuilder } from './utils/ChartConfigBuilder';
import { ChartBuilder } from './core/ChartBuilder';
import { FilterControls } from './FilterControls';
import { FilterEngine } from './utils/FilterEngine';


// Export Row type for compatibility
export type { Row };



// In ChartJS.tsx
export type FilterCondition = {
  id: string;
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'not_contains' | 'empty' | 'not_empty' | 'between';
  value?: any;
  value2?: any; // for 'between' operator
};

export type DateFilter = {
  id: string;
  field: string;
  operator: 'gt' | 'lt' | 'eq' | 'between';
  value?: Date;
  value2?: Date; // for 'between' operator
};


// LLM chart spec shape we expect
export type LLMChartSpec = {
  mark?: string;
  x?: string;
  y?: string[];
  color?: string;
};

// Validate that a field exists in the known catalog (supports virtual time "col::part")
function fieldExists(fields: Field[], name?: string) {
  if (!name) return false;
  const base = name.split("::")[0];
  return fields.some(f => f.name === name || f.name === base);
}

function sanitizeSpec(spec: LLMChartSpec | undefined, fields: Field[]) {
  const errs: string[] = [];
  if (!spec) return { enc: { y: [] } as EncodingSlots, mark: undefined, errs };

  const enc: EncodingSlots = { y: [] };
  let mark: string | undefined = spec.mark;

  // x
  if (spec.x) {
    if (fieldExists(fields, spec.x)) enc.x = spec.x;
    else errs.push(`Unknown x: ${spec.x}`);
  }

  // y[]
  if (Array.isArray(spec.y)) {
    enc.y = spec.y.filter(n => fieldExists(fields, n));
    if (spec.y.length && !enc.y.length) errs.push(`All suggested y fields unknown: ${spec.y.join(", ")}`);
  }

  // color
  if (spec.color) {
    if (fieldExists(fields, spec.color)) enc.color = spec.color;
    else errs.push(`Unknown color: ${spec.color}`);
  }

  // minimal fallback if LLM gave nothing usable
  if (!enc.x) {
    const firstTemporal = fields.find(f => f.type === 'temporal')?.name;
    if (firstTemporal) enc.x = firstTemporal;
  }
  if (!enc.y?.length) {
    const firstMeasure = fields.find(f => f.type === 'quantitative')?.name;
    if (firstMeasure) enc.y = [firstMeasure];
  }

  // If mark is garbage, let your existing auto-recommender pick it
  if (mark && !['bar','bar-stacked','line','area','point','pie','heatmap'].includes(mark)) {
    errs.push(`Unknown mark: ${mark} (using auto)`);
    mark = undefined;
  }

  return { enc, mark, errs };
}


// ---------- MINIMAL COMPONENTS ----------
function FieldChip({
  name, bg, border, text, onClear, dragging,
}: {
  name: string; bg: string; border: string; text: string;
  dragging?: boolean; onClear?: () => void;
}) {
  return (
    <div
      className="field-chip"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', borderRadius: 999, border: `1px solid ${border}`,
        background: '#23293a', color: '#e6edf3',
        boxShadow: dragging ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
        margin: 4, cursor: 'grab', userSelect: 'none', fontSize: 12, touchAction: 'none',
      }}
    >
      {name}
      {onClear && (
        <button
          type="button" aria-label={`Remove ${name}`}
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          style={{
            cursor: 'pointer', border: 'none', background: 'transparent',
            width: 18, height: 18, lineHeight: '18px', textAlign: 'center',
            borderRadius: 999, color: '#9fbad0', opacity: 0.85,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function DraggableField({ name, kind }: { name: string; kind: 'dimension' | 'measure' }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: name });
  const c = ChartConfigBuilder.chipColors(kind);
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ display: 'inline-block' }}>
      <FieldChip name={name} bg={c.bg} border={c.border} text={c.text} />
    </div>
  );
}

function DropZone({
  id, label, children,
}: React.PropsWithChildren<{ id: keyof EncodingSlots; label: string }>) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 56, padding: 8,
        border: `2px dashed ${isOver ? '#1f6feb' : '#2d3648'}`,
        borderRadius: 10, background: isOver ? 'rgba(31,111,235,0.12)' : 'transparent',
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div style={{ fontSize: 11, color: '#9fbad0', marginBottom: 4 }}>{label}</div>
      {children}
      {!children && <div style={{ fontSize: 12, color: '#7a8596' }}>Drop a field here</div>}
    </div>
  );
}

// ---------- MINIMAL CONTEXT ----------
const ChartCtx = createContext<ChartState | null>(null);
function useChartCtx() {
  const ctx = useContext(ChartCtx);
  if (!ctx) throw new Error('ChartCtx not found. Wrap with <ChartProvider>.');
  return ctx;
}

export { useChartCtx };

export function ChartProvider({
    rows,
    prefill,
    onPrefillWarnings,
    children
  }: React.PropsWithChildren<{
    rows: Row[];
    prefill?: LLMChartSpec | null;
    onPrefillWarnings?: (warnings: string[]) => void;
  }>) {

  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [dateFilters, setDateFilters] = useState<DateFilter[]>([]);
  // Apply filters to raw data
  const filteredRows = useMemo(() => {
    return FilterEngine.applyFilters(rows, filters, dateFilters);
  }, [rows, filters, dateFilters]);
  // Use filtered data for everything else
const fields = useMemo(() => DataProcessor.buildFieldCatalog(rows), [rows]);
const { dimensions, measures } = useMemo(() => DataProcessor.categorizeFields(fields), [fields]);

  
  const [enc, setEnc] = useState<EncodingSlots>({ y: [] });
  const [explicitMark, setExplicitMark] = useState<string | undefined>(undefined);
  const [colorScaleMode, setColorScaleMode] = useState<'hue' | 'alpha'>('hue');
  const [gradientStart, setGradientStart] = useState('#07003d');
  const [gradientEnd, setGradientEnd] = useState('#bd0f89');
  
  // Chart recommendation delegated to module
  const mark = explicitMark ?? ChartConfigBuilder.recommendMark(enc, fields);

  const value: ChartState = {
    rows: filteredRows, // Use filtered data
    originalRows: rows, // Keep original for reference
    fields, dimensions, measures,
    enc, setEnc,
    mark, setExplicitMark,
    colorScaleMode, setColorScaleMode,
    gradientStart, setGradientStart,
    gradientEnd, setGradientEnd,
    filters, setFilters,
    dateFilters, setDateFilters,
  };




  // Apply LLM prefill safely whenever fields/prefill change
  React.useEffect(() => {
    if (!prefill) return;
    const { enc: next, mark: m, errs } = sanitizeSpec(prefill, fields);
    setEnc(next);
    setExplicitMark(m); // may be undefined -> falls back to auto
    if (errs?.length && onPrefillWarnings) onPrefillWarnings(errs);
  }, [prefill, fields]);

  return <ChartCtx.Provider value={value}>{children}</ChartCtx.Provider>;
}

// ---------- ULTRA-MINIMAL RENDERER (ALL LOGIC IN MODULES) ----------
function ChartJSRenderer({
  rows, enc, fields, mark, style,
}: { rows: Row[], enc: EncodingSlots, fields: Field[], mark: string, style?: React.CSSProperties }) {
  const { colorScaleMode, gradientStart, gradientEnd } = useChartCtx();

  // ALL Chart.js configuration logic moved to ChartBuilder!
  const config = useMemo(() => {
    const chartBuilder = new ChartBuilder(rows)
      .setEncoding(enc)
      .setMark(mark as any)
      .setColorMode(colorScaleMode)
      .setColorGradient(gradientStart, gradientEnd);

    return chartBuilder.render();
  }, [rows, enc, mark, colorScaleMode, gradientStart, gradientEnd]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <ReactChart type={config.type as any} data={config.data} options={config.options} />
    </div>
  );
}

// Center column: chart only
export function ChartCanvas({ style }: { style?: React.CSSProperties }) {
  const { rows, enc, fields, mark } = useChartCtx();
  return <ChartJSRenderer rows={rows} enc={enc} fields={fields} mark={mark} style={style} />;
}

// ---------- MINIMAL CONTROLS ----------
export function ChartControls() {
  // Remove the hasRows parameter completely
  const {
    dimensions, measures, enc, setEnc, mark, setExplicitMark, fields,
    colorScaleMode, setColorScaleMode, gradientStart, setGradientStart, gradientEnd, setGradientEnd
  } = useChartCtx();
  
  const [activeId, setActiveId] = useState<string | null>(null);
  const [temporalDropdowns, setTemporalDropdowns] = useState<Record<string, boolean>>({});
  
  

  const chipThemeFor = (name: string) =>
    measures.some((m) => m.name === name) ? ChartConfigBuilder.chipColors('measure') : ChartConfigBuilder.chipColors('dimension');

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
      if (slot === 'y') {
        if (prev.y.includes(field)) return prev;
        return { ...prev, y: [...prev.y, field] };
      }
      return { ...prev, [slot]: field };
    });
  }

  const toggleTemporal = (fieldName: string) => {
    setTemporalDropdowns(prev => ({
      ...prev,
      [fieldName]: !prev[fieldName]
    }));
  };

  const colorFieldType = enc.color ? fields.find(f => f.name === enc.color)?.type : undefined;
  const colorIsMeasure = colorFieldType === 'quantitative';

  return (
    <div style={{ padding: 8, maxHeight: '100%',  position: 'relative' }}>
      <DndContext
        onDragStart={(e) => setActiveId(e.active?.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* Fields */}
        <section>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Fields</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#9fbad0', marginBottom: 4 }}>Dimensions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {dimensions.map((f) => {
                const isTemporal = f.type === 'temporal';
                const isOpen = temporalDropdowns[f.name] || false; // Use external state

                return (
                  <div key={f.name} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', margin: 2 }}>
                    <DraggableField name={f.name} kind="dimension" />
                    {isTemporal && (
                      <button
                        type="button"
                        onClick={() => toggleTemporal(f.name)} // Use external function
                        style={{
                          marginLeft: 4, fontSize: 10, lineHeight: 1,
                          border: '1px solid #2d3648', background: '#1b2332', color: '#9fbad0',
                          borderRadius: 4, padding: '1px 4px', cursor: 'pointer'
                        }}
                      >
                        ▼
                      </button>
                    )}
                    {isTemporal && isOpen && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, marginTop: 4, padding: 6,
                        background: '#0f172a', border: '1px solid #2d3648', borderRadius: 8, zIndex: 100,
                        display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: 4
                      }}>
                        {TimeHierarchy.TIME_PARTS.map(part => (
                          <DraggableField
                            key={`${f.name}::${part}`}
                            name={`${f.name}::${part}`}
                            kind="dimension"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Rest of your component remains the same */}
          
          <div>
            <div style={{ fontSize: 12, color: '#9fbad0', marginBottom: 4 }}>Measures</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {measures.map((f) => (
                <DraggableField key={f.name} name={f.name} kind="measure" />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, color: '#9fbad0' }}>Mark</label>
            <select
              value={mark === ChartConfigBuilder.recommendMark(enc, fields) ? '' : mark}
              onChange={(e) => setExplicitMark(e.target.value || undefined)}
              className="chart-select"
            >
              <option value="">(auto)</option>
              <option value="bar">Bar</option>
              <option value="bar-stacked">Stacked Bar</option>
              <option value="line">Line</option>
              <option value="area">Area</option>
              <option value="point">Scatter</option>
              <option value="pie">Pie</option>
              <option value="heatmap">Heatmap</option>
            </select>
          </div>
        </section>

        {/* Encodings */}
        <section style={{ marginTop: 12, borderTop: '1px solid #2d3648', paddingTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Encodings</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <DropZone id="x" label="X">
              {enc.x && (() => {
                const c = chipThemeFor(enc.x!);
                return <FieldChip name={enc.x!} bg={c.bg} border={c.border} text={c.text} onClear={() => clearSlot('x')} />;
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

            <DropZone id="color" label="Color (series / gradient)">
              {enc.color && (() => {
                const c = chipThemeFor(enc.color!);
                return <FieldChip name={enc.color!} bg={c.bg} border={c.border} text={c.text} onClear={() => clearSlot('color')} />;
              })()}
            </DropZone>

            {colorIsMeasure && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: '#9fbad0' }}>Color mode</label>
                <select
                  value={colorScaleMode}
                  onChange={(e) => setColorScaleMode(e.target.value as 'hue' | 'alpha')}
                 className="chart-select"
                >
                  <option value="hue">Color scale</option>
                  <option value="alpha">Alpha gradient</option>
                </select>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#9fbad0' }}>Low</span>
                  <input
                    type="color"
                    value={gradientStart}
                    onChange={(e) => setGradientStart(e.target.value)}
                    style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent' }}
                  />
                  <span style={{ fontSize: 12, color: '#9fbad0' }}>High</span>
                  <input
                    type="color"
                    value={gradientEnd}
                    onChange={(e) => setGradientEnd(e.target.value)}
                    disabled={colorScaleMode === 'alpha'}
                    style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent', opacity: colorScaleMode === 'alpha' ? 0.5 : 1 }}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Drag ghost */}
        <DragOverlay dropAnimation={null}>
          {activeId ? (() => {
            const isMeasure = measures.some(m => m.name === activeId);
            const c = isMeasure ? ChartConfigBuilder.chipColors('measure') : ChartConfigBuilder.chipColors('dimension');
            return (
              <div style={{ zIndex: 9999, pointerEvents: 'none' }}>
                <FieldChip name={activeId} bg={c.bg} border={c.border} text={c.text} dragging />
              </div>
            );
          })() : null}
        </DragOverlay>

              <FilterControls />

      </DndContext>

    </div>
  );
}