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
  MatrixController,MatrixElement
);

// ---------- types ----------
export type Row = Record<string, any>;

type EncodingSlots = {
  x?: string;
  y: string[];          // multiple measures supported
  color?: string;
  size?: string;        // used for PIE values when present
  row?: string;         // (unused here)
  column?: string;      // (unused here)
};

type Field = { name: string; type: 'quantitative' | 'temporal' | 'nominal' | 'ordinal' };

// ---------- palette + helpers ----------
const SERIES_COLORS = [
  '#1f77b4', // blue
  '#e377c2', // pink-red
  '#2ca02c', '#ff7f0e', '#9467bd',
  '#8c564b', '#17becf', '#bcbd22',
  '#d62728', '#7f7f7f',
];
const BASE_BLUE = SERIES_COLORS[0];

const withAlpha = (hex: string, alpha = 0.35) => {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function interpolateColor(val: number, min: number, max: number, lowHex: string, highHex: string) {
  const t = (val - min) / (max - min || 1);
  const lr = parseInt(lowHex.slice(1,3), 16);
  const lg = parseInt(lowHex.slice(3,5), 16);
  const lb = parseInt(lowHex.slice(5,7), 16);
  const hr = parseInt(highHex.slice(1,3), 16);
  const hg = parseInt(highHex.slice(3,5), 16);
  const hb = parseInt(highHex.slice(5,7), 16);
  const r = Math.round(lr + t * (hr - lr));
  const g = Math.round(lg + t * (hg - lg));
  const b = Math.round(lb + t * (hb - lb));
  return `rgb(${r},${g},${b})`;
}

function colorArrayFromValues(
  vals: number[],
  mode: 'hue' | 'alpha',
  vmin: number,
  vmax: number,
  startHex: string,
  endHex: string
) {
  return vals.map(v => {
      const t = (v - vmin) / (vmax - vmin || 1);
    if (mode === 'alpha') {
      const a = 0.25 + t * (0.9 - 0.25);
      return withAlpha(startHex || BASE_BLUE, a);
    }
    return interpolateColor(v, vmin, vmax, startHex || '#c8e6c9', endHex || '#e377c2');
  });
}

// ----- Virtual time fields (e.g. created_at::month) -----
const TIME_PARTS = ['year','quarter','month','week','day','hour','minute','second'] as const;
type TimePart = typeof TIME_PARTS[number];

function toDate(v: any): Date | null {
  if (v instanceof Date) return v;
  if (v == null) return null;
  const d = new Date(v);
  return isNaN(+d) ? null : d;
}

function extractTimePart(d: Date, part: TimePart): number {
  const y = d.getFullYear();
  const m = d.getMonth(); // 0..11
  switch (part) {
    case 'year': return y;
    case 'quarter': return Math.floor(m / 3) + 1;         // 1..4
    case 'month': return m + 1;                           // 1..12
    case 'week': {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = (t.getUTCDay() + 6) % 7;
      t.setUTCDate(t.getUTCDate() - dayNum + 3);
      const firstThursday = new Date(Date.UTC(t.getUTCFullYear(),0,4));
      return 1 + Math.round(((t.getTime() - firstThursday.getTime())/86400000 - 3 + ((firstThursday.getUTCDay()+6)%7))/7);
    }
    case 'day': return d.getDate();                       // 1..31
    case 'hour': return d.getHours();                     // 0..23
    case 'minute': return d.getMinutes();                 // 0..59
    case 'second': return d.getSeconds();                 // 0..59
  }
}

function isVirtualTimeField(name?: string): { base: string; part: TimePart } | null {
  if (!name) return null;
  const idx = name.indexOf('::');
  if (idx === -1) return null;
  const part = name.slice(idx + 2) as TimePart;
  if (!(TIME_PARTS as readonly string[]).includes(part)) return null;
  return { base: name.slice(0, idx), part: part as TimePart };
}

function getFieldValue(row: Row, name?: string) {
  if (!name) return undefined;
  const vt = isVirtualTimeField(name);
  if (!vt) return row[name];
  const d = toDate(row[vt.base]);
  if (!d) return undefined;
  return extractTimePart(d, vt.part);
}

function prettyTimeLabel(part: TimePart, v: number) {
  if (part === 'month') {
    return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Math.max(1,Math.min(12,v))-1];
  }
  if (part === 'quarter') return `Q${v}`;
  if (part === 'hour') return `${v}:00`;
  return String(v);
}

// --- other helpers ---
function unique<T>(arr: T[]) { return Array.from(new Set(arr)); }

function inferType(values: any[]): Field['type'] {
  const sample = values.find((v) => v !== null && v !== undefined);
  if (sample instanceof Date) return 'temporal';
  if (typeof sample === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return 'temporal';
    if (/^-?\d+(\.\d+)?$/.test(sample)) return 'quantitative'; // numeric strings
    return 'nominal';
  }
  if (typeof sample === 'number') return 'quantitative';
  return 'nominal';
}

function sortLabels(labels: any[], type: Field['type']) {
  if (type === 'temporal') return labels.slice().sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  if (type === 'quantitative') return labels.slice().sort((a, b) => Number(a) - Number(b));
  return labels.slice().sort((a, b) => String(a).localeCompare(String(b)));
}

function buildCatalog(rows: Row[]): Field[] {
  if (!rows?.length) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((k) => ({ name: k, type: inferType(rows.map((r) => r[k])) }));
}

function recommendedMark(enc: EncodingSlots, fields: Field[]) {
  const typeOf = (n?: string) => fields.find((f) => f.name === n)?.type;
  const x = typeOf(enc.x);
  if ((enc.y?.length ?? 0) > 1) return 'line';
  const y = typeOf(enc.y?.[0]);
  if (x === 'temporal' && y === 'quantitative') return 'line';
  if (x === 'nominal' && y === 'quantitative') return 'bar';
  if (x === 'quantitative' && y === 'quantitative') return 'point';
  return 'bar';
}

// ---------- chips / dnd atoms ----------
function chipColors(kind: 'dimension' | 'measure') {
  return kind === 'dimension'
    ? { bg: '#ffecb3', border: '#fbc02d', text: '#5d4037' }
    : { bg: '#c8e6c9', border: '#388e3c', text: '#1b5e20' };
}

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
  const c = chipColors(kind);
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

// ---------- context & split components ----------
type ChartState = {
  rows: Row[];
  fields: Field[];
  dimensions: Field[];
  measures: Field[];
  enc: EncodingSlots;
  setEnc: React.Dispatch<React.SetStateAction<EncodingSlots>>;
  mark: string;
  setExplicitMark: React.Dispatch<React.SetStateAction<string | undefined>>;
  colorScaleMode: 'hue' | 'alpha';
  setColorScaleMode: React.Dispatch<React.SetStateAction<'hue' | 'alpha'>>;
  gradientStart: string;
  setGradientStart: React.Dispatch<React.SetStateAction<string>>;
  gradientEnd: string;
  setGradientEnd: React.Dispatch<React.SetStateAction<string>>;
};

const ChartCtx = createContext<ChartState | null>(null);
function useChartCtx() {
  const ctx = useContext(ChartCtx);
  if (!ctx) throw new Error('ChartCtx not found. Wrap with <ChartProvider>.');
  return ctx;
}

export function ChartProvider({ rows, children }: React.PropsWithChildren<{ rows: Row[] }>) {
  const fields = useMemo(() => buildCatalog(rows), [rows]);
  const dimensions = fields.filter((f) => f.type !== 'quantitative');
  const measures = fields.filter((f) => f.type === 'quantitative');
  const [enc, setEnc] = useState<EncodingSlots>({ y: [] });
  const [explicitMark, setExplicitMark] = useState<string | undefined>(undefined);
  const [colorScaleMode, setColorScaleMode] = useState<'hue' | 'alpha'>('hue');
  const [gradientStart, setGradientStart] = useState('#07003d'); // default
  const [gradientEnd, setGradientEnd] = useState('#bd0f89');     // default
  const mark = explicitMark ?? recommendedMark(enc, fields);

  const value: ChartState = {
    rows, fields, dimensions, measures,
    enc, setEnc,
    mark, setExplicitMark,
    colorScaleMode, setColorScaleMode,
    gradientStart, setGradientStart,
    gradientEnd, setGradientEnd,
  };

  return <ChartCtx.Provider value={value}>{children}</ChartCtx.Provider>;
}

// ---------- Chart.js renderer (bar/stacked/line/area/point/pie) ----------
function ChartJSRenderer({
  rows, enc, fields, mark, style,
}: { rows: Row[], enc: EncodingSlots, fields: Field[], mark: string, style?: React.CSSProperties }) {
  const { colorScaleMode, gradientStart, gradientEnd } = useChartCtx();

  const config = useMemo(() => {
    const colorForIndex = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];

    const xField = enc.x;
    const yFields = enc.y ?? [];
    const colorField = enc.color;
    const isStacked = mark === 'bar-stacked';

    // X labels (sorted) — supports virtual time fields (e.g. created_at::month)
    const xBaseType = xField ? fields.find(f => f.name === xField)?.type ?? 'nominal' : 'nominal';
    const xVirt = isVirtualTimeField(xField);
    const rawX = xField
      ? rows.map(r => getFieldValue(r, xField))
      : rows.map((_, i) => i);

    let labels: any[] = [];
    if (xField) {
      if (xVirt) {
        const nums = unique(rawX.filter(v => v !== undefined) as number[]);
        labels = nums.sort((a,b) => Number(a) - Number(b));
      } else {
        labels = sortLabels(unique(rawX), xBaseType as Field['type']);
      }
    } else {
      labels = rawX;
    }

    const typeOf = (n?: string) => fields.find((f) => f.name === n)?.type;

    // PIE (special handling)
    if (mark === 'pie') {
      const categoryField = [enc.x, enc.color].find(n => n && typeOf(n) !== 'quantitative');
      const valueField = (enc.size && typeOf(enc.size) === 'quantitative' ? enc.size : yFields[0]) as string | undefined;

      if (!categoryField || !valueField) {
        return { type: 'pie', data: { labels: [], datasets: [] }, options: {} } as const;
      }

      const catType = typeOf(categoryField) ?? 'nominal';
      const pieLabels = sortLabels(unique(rows.map(r => r[categoryField as string])), catType);

      const values = pieLabels.map(cat =>
        rows
          .filter(r => r[categoryField as string] === cat)
          .reduce((s, r) => s + (Number(r[valueField!]) || 0), 0)
      );

      const colorIsMeasure = enc.color && typeOf(enc.color) === 'quantitative';
      let backgroundColor: string[] = [];
      let borderColor: string[] = [];

      if (colorIsMeasure) {
        const colorVals = pieLabels.map(cat =>
          rows
            .filter(r => r[categoryField as string] === cat)
            .reduce((s, r) => s + (Number(r[enc.color!]) || 0), 0)
        );
        const cmin = Math.min(...colorVals);
        const cmax = Math.max(...colorVals);
        const colors = colorArrayFromValues(colorVals, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);
        backgroundColor = colors;
        borderColor = colors;
      } else {
        backgroundColor = pieLabels.map((_, i) => withAlpha(colorForIndex(i), 0.7));
        borderColor     = pieLabels.map((_, i) => colorForIndex(i));
      }

      return {
        type: 'pie',
        data: {
          labels: pieLabels,
          datasets: [{
            label: valueField!,
            data: values,
            backgroundColor,
            borderColor,
            borderWidth: 1,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right' }, tooltip: { enabled: true } }
        }
      } as const;
    }

    // HEATMAP (matrix) using existing Y (no separate row dropzone)
    if (mark === 'heatmap') {
      const xDim = enc.x;
      if (!xDim) {
        return { type: 'matrix', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } } as const;
      }

      const yDim = (enc.y || []).find(n => typeOf(n) !== 'quantitative') ?? (enc.y?.[0]);
      const valueField =
        (enc.color && typeOf(enc.color) === 'quantitative')
          ? enc.color
          : (enc.y || []).find(n => typeOf(n) === 'quantitative');

      if (!yDim || !valueField) {
        return { type: 'matrix', data: { labels: [], datasets: [] }, options: { responsive: true, maintainAspectRatio: false } } as const;
      }

      const xT = typeOf(xDim) ?? 'nominal';
      const normDay = (v: any) => {
        if (xT === 'temporal') {
          const d = v instanceof Date ? v : new Date(v);
          return d.toISOString().slice(0, 10);
        }
        return String(v);
      };

      const yT = typeOf(yDim) ?? 'nominal';
      const normRow = (v: any) => (yT === 'quantitative' ? Number(v) : String(v));

      const xVals = rows.map(r => normDay(getFieldValue(r, xDim)));
      const yVals = rows.map(r => normRow(getFieldValue(r, yDim)));

      const xLabels = sortLabels(unique(xVals), 'nominal');
      const yLabels = (yT === 'quantitative')
        ? Array.from(new Set(yVals as number[])).sort((a,b) => Number(a) - Number(b))
        : sortLabels(unique(yVals), 'nominal');

      const xIndex = new Map(xLabels.map((v, i) => [v, i]));
      const yIndex = new Map(yLabels.map((v, i) => [v, i]));

      const grid = Array.from({ length: yLabels.length }, () => new Array<number>(xLabels.length).fill(0));
      for (const r of rows) {
        const xi = xIndex.get(normDay(getFieldValue(r, xDim)));
        const yi = yIndex.get(normRow(getFieldValue(r, yDim)));
        if (xi === undefined || yi === undefined) continue;
        grid[yi][xi] += Number(r[valueField] ?? 0);
      }

      const points: { x: number; y: number; v: number }[] = [];
      for (let yi = 0; yi < yLabels.length; yi++) {
        for (let xi = 0; xi < xLabels.length; xi++) {
          points.push({ x: xi, y: yi, v: grid[yi][xi] });
        }
      }

      let colorVals: number[] = points.map(p => p.v);
      if (enc.color && typeOf(enc.color) === 'quantitative') {
        const colorGrid = Array.from({ length: yLabels.length }, () => new Array<number>(xLabels.length).fill(0));
        for (const r of rows) {
          const xi = xIndex.get(normDay(getFieldValue(r, xDim)));
          const yi = yIndex.get(normRow(getFieldValue(r, yDim)));
          if (xi === undefined || yi === undefined) continue;
          colorGrid[yi][xi] += Number(r[enc.color] ?? 0);
        }
        colorVals = [];
        for (let yi = 0; yi < yLabels.length; yi++) {
          for (let xi = 0; xi < xLabels.length; xi++) {
            colorVals.push(colorGrid[yi][xi]);
          }
        }
      }

      const vmin = Math.min(...colorVals);
      const vmax = Math.max(...colorVals);
      const valueToColor = (val: number) => {
        const t = (val - vmin) / (vmax - vmin || 1);
        if (colorScaleMode === 'alpha') {
          const a = 0.25 + t * (0.9 - 0.25);
          return withAlpha(gradientStart || '#1f77b4', a);
        }
        return interpolateColor(val, vmin, vmax, gradientStart || '#c8e6c9', gradientEnd || '#e377c2');
      };

      return {
        type: 'matrix',
        data: {
          labels: xLabels,
          datasets: [{
            label: valueField,
            data: points,
            backgroundColor: (ctx: any) => valueToColor(colorVals[ctx.dataIndex]),
            borderColor: 'rgba(0,0,0,0.08)',
            borderWidth: 1,
            width: ({ chart }: any) => {
              const a = chart?.chartArea;
              const n = Array.isArray(xLabels) ? xLabels.length : 0;
              return a && n > 0 ? Math.max(2, (a.right - a.left) / n - 2) : 10;
            },
            height: ({ chart }: any) => {
              const a = chart?.chartArea;
              const n = Array.isArray(yLabels) ? yLabels.length : 0;
              return a && n > 0 ? Math.max(2, (a.bottom - a.top) / n - 2) : 10;
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items: any[]) => {
                  const p = items[0].raw as { x: number; y: number };
                  const xLab = xLabels[p.x];
                  const yLab = yLabels[p.y];
                  return `${xLab} • ${yT === 'quantitative' ? `${yLab}:00` : yLab}`;
                },
                label: (item: any) => `${valueField}: ${item.raw.v}`
              }
            }
          },
          scales: {
            x: {
              type: 'linear',
              min: -0.5,
              max: (Array.isArray(xLabels) ? xLabels.length : 0) - 0.5,
              grid: { display: false },
              ticks: {
                autoSkip: false,
                maxTicksLimit: 12,
                callback: (val: any) => {
                  const i = Math.round(Number(val));
                  return Array.isArray(xLabels) && xLabels[i] !== undefined ? xLabels[i] : '';
                }
              }
            },
            y: {
              type: 'linear',
              min: -0.5,
              max: (Array.isArray(yLabels) ? yLabels.length : 0) - 0.5,
              grid: { display: false },
              reverse: true,
              ticks: {
                autoSkip: false,
                callback: (val: any) => {
                  const i = Math.round(Number(val));
                  const lab = yLabels[i];
                  return lab === undefined ? '' : (yT === 'quantitative' ? `${lab}:00` : String(lab));
                }
              }
            }
          }
        }
      } as const;
    }

    // BAR / STACKED / LINE / AREA / SCATTER
    const datasets: any[] = [];
    const styleDataset = (base: any, color: string) => {
      const isBar = mark === 'bar' || mark === 'bar-stacked';
      if (isBar) {
        return { ...base, backgroundColor: withAlpha(color, 0.6), borderColor: color, borderWidth: 1 };
      }
      return { ...base, borderColor: color, backgroundColor: withAlpha(color, mark === 'area' ? 0.3 : 0.15) };
    };

    const colorIsMeasure = colorField && typeOf(colorField) === 'quantitative';

    if (colorIsMeasure) {
      const isBar = mark === 'bar' || mark === 'bar-stacked';

      if (xField) {
        const labelIndex = new Map<any, number>();
        labels.forEach((v, i) => labelIndex.set(v, i));

        const seriesByY = yFields.map(() => new Array(labels.length).fill(0));
        const colorSeries = new Array(labels.length).fill(0);

        for (const r of rows) {
          const xi = labelIndex.get(getFieldValue(r, xField)!);
          if (xi === undefined) continue;
          for (let yi = 0; yi < yFields.length; yi++) {
            seriesByY[yi][xi] += Number(r[yFields[yi]] ?? 0);
          }
          colorSeries[xi] += Number(r[colorField!] ?? 0);
        }

        const cmin = Math.min(...colorSeries);
        const cmax = Math.max(...colorSeries);
        const colors = colorArrayFromValues(colorSeries, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);

        for (let yi = 0; yi < yFields.length; yi++) {
          const base: any = {
            label: yFields[yi],
            data: seriesByY[yi],
            fill: mark === 'area',
            showLine: !isBar,
            pointRadius: mark === 'point' ? 3 : (isBar ? 0 : 2),
            tension: 0.25,
            stack: isStacked ? 'stack1' : undefined,
          };

          if (isBar) {
            base.backgroundColor = colors;
            base.borderColor = colors;
            base.borderWidth = 1;
          } else {
            base.borderColor = '#9fbad0';
            base.backgroundColor = withAlpha('#9fbad0', mark === 'area' ? 0.25 : 0.15);
            base.pointBackgroundColor = colors;
            base.pointBorderColor = colors;
          }

          datasets.push(base);
        }
      } else {
        const colorSeries = rows.map(r => Number(r[colorField!] ?? 0));
        const cmin = Math.min(...colorSeries);
        const cmax = Math.max(...colorSeries);
        const colors = colorArrayFromValues(colorSeries, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);

        for (let yi = 0; yi < yFields.length; yi++) {
          const series = rows.map(r => Number(r[yFields[yi]] ?? 0));
          const base: any = {
            label: yFields[yi],
            data: series,
            fill: mark === 'area',
            showLine: mark !== 'point' && !(mark === 'bar' || mark === 'bar-stacked'),
            pointRadius: mark === 'point' ? 3 : ((mark === 'bar' || mark === 'bar-stacked') ? 0 : 2),
            tension: 0.25,
            stack: isStacked ? 'stack1' : undefined,
          };

          if (mark === 'bar' || mark === 'bar-stacked') {
            base.backgroundColor = colors;
            base.borderColor = colors;
            base.borderWidth = 1;
          } else {
            base.borderColor = '#9fbad0';
            base.backgroundColor = withAlpha('#9fbad0', mark === 'area' ? 0.25 : 0.15);
            base.pointBackgroundColor = colors;
            base.pointBorderColor = colors;
          }

          datasets.push(base);
        }
      }
    } else if (colorField) {
      const cats = sortLabels(unique(rows.map(r => r[colorField])), 'nominal');
      for (let yi = 0; yi < yFields.length; yi++) {
        const y = yFields[yi];
        const perCat: Record<string, number[]> = {};
        for (const c of cats) perCat[c] = new Array(labels.length).fill(0);
        for (const r of rows) {
          const xi = xField ? labels.indexOf(getFieldValue(r, xField)) : -1;
          const c = r[colorField];
          if (xi >= 0 && c in perCat) perCat[c][xi] += Number(r[y] ?? 0);
        }
        cats.forEach((c, ci) => {
          const base = {
            label: `${y} • ${c}`,
            data: perCat[c],
            fill: mark === 'area',
            showLine: mark !== 'point' && !(mark === 'bar' || mark === 'bar-stacked'),
            pointRadius: mark === 'point' ? 3 : ((mark === 'bar' || mark === 'bar-stacked') ? 0 : 2),
            tension: 0.25,
            stack: isStacked ? 'stack1' : undefined,
          };
          datasets.push(styleDataset(base, colorForIndex(ci)));
        });
      }
    } else {
      for (let yi = 0; yi < yFields.length; yi++) {
        const y = yFields[yi];
        const series = new Array(labels.length).fill(0);
        for (const r of rows) {
          const xi = xField ? labels.indexOf(getFieldValue(r, xField)) : -1;
          if (xi >= 0) series[xi] += Number(r[y] ?? 0);
        }
        const base = {
          label: y,
          data: series,
          fill: mark === 'area',
          showLine: mark !== 'point' && !(mark === 'bar' || mark === 'bar-stacked'),
          pointRadius: mark === 'point' ? 3 : ((mark === 'bar' || mark === 'bar-stacked') ? 0 : 2),
          tension: 0.25,
          stack: isStacked ? 'stack1' : undefined,
        };
        datasets.push(styleDataset(base, colorForIndex(yi)));
      }
    }

    const xScaleType =
      xVirt ? 'linear' :
      (xBaseType === 'temporal' ? 'time' :
       xBaseType === 'quantitative' ? 'linear' : 'category');

    const type =
      (mark === 'bar' || mark === 'bar-stacked') ? 'bar' :
      mark === 'point' ? 'scatter' :
      'line'; // line & area both render as 'line' (area uses fill: true)

    return {
      type,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false, // allow container to dictate size
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (items: any[]) => {
                if (!xVirt) return undefined;
                const i = items[0]?.dataIndex ?? 0;
                const v = labels[i];
                return prettyTimeLabel(xVirt.part, Number(v));
              }
            }
          },
          title: { display: false },
          zoom: { zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, pan: { enabled: true, mode: 'x' } }
        },
        scales: {
          x: {
            type: xScaleType,
            stacked: isStacked,
            ticks: {
              autoSkip: true,
              maxTicksLimit: 12,
              callback: (val: any) => {
                if (!xVirt) return undefined; // default labeling
                const i = Math.round(Number(val));
                const lab = labels[i];
                return lab == null ? '' : prettyTimeLabel(xVirt.part, Number(lab));
              }
            },
            grid: { display: false }
          },
          y: {
            stacked: isStacked,
            beginAtZero: isStacked,
            grid: { color: 'rgba(148,163,184,0.2)' }
          }
        }
      }
    } as const;
  }, [rows, enc, fields, mark, colorScaleMode, gradientStart, gradientEnd]);

  // IMPORTANT: no fixed pixel height here. The parent controls the height.
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

// Right column: fields + encodings + DnD
export function ChartControls() {
const {
  dimensions, measures, enc, setEnc, mark, setExplicitMark, fields,
  colorScaleMode, setColorScaleMode, gradientStart, setGradientStart, gradientEnd, setGradientEnd
} = useChartCtx();
  const [activeId, setActiveId] = useState<string | null>(null);

  const chipThemeFor = (name: string) =>
    measures.some((m) => m.name === name) ? chipColors('measure') : chipColors('dimension');

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

  const colorFieldType = enc.color ? fields.find(f => f.name === enc.color)?.type : undefined;
  const colorIsMeasure = colorFieldType === 'quantitative';

  return (
    <div style={{ padding: 8, position: 'relative' }}>
      <DndContext
        onDragStart={(e) => setActiveId(e.active?.id as string)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        {/* Palette */}
        <section>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Fields</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#9fbad0', marginBottom: 4 }}>Dimensions</div>
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {dimensions.map((f) => {
                const isTemporal = f.type === 'temporal';
                const [open, setOpen] = useState(false);

                return (
                  <div key={f.name} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', margin: 2 }}>
                    <DraggableField name={f.name} kind="dimension" />
                    {isTemporal && (
                      <button
                        type="button"
                        aria-label={`Expand ${f.name}`}
                        onClick={() => setOpen(o => !o)}
                        style={{
                          marginLeft: 4,
                          fontSize: 10,
                          lineHeight: 1,
                          border: '1px solid #2d3648',
                          background: '#1b2332',
                          color: '#9fbad0',
                          borderRadius: 4,
                          padding: '1px 4px',
                          cursor: 'pointer'
                        }}
                      >
                        ▼
                      </button>
                    )}
                    {isTemporal && open && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          marginTop: 4,
                          padding: 6,
                          background: '#0f172a',
                          border: '1px solid #2d3648',
                          borderRadius: 8,
                          zIndex: 100,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2, max-content)',
                          gap: 4
                        }}
                      >
                        {TIME_PARTS.map(part => (
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
              className="input"
              value={
                mark === recommendedMark(enc, fields) ? '' : mark
              }
              onChange={(e) => setExplicitMark(e.target.value || undefined)}
              style={{ display: 'block', marginTop: 4 }}
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
                  className="input"
                  value={colorScaleMode}
                  onChange={(e) => setColorScaleMode(e.target.value as 'hue' | 'alpha')}
                  style={{ display: 'block', marginTop: 4 }}
                >
                  <option value="hue">Color scale</option>
                  <option value="alpha">Alpha gradient</option>
                </select>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#9fbad0' }}>Start</span>
                  <input
                    type="color"
                    value={gradientStart}
                    onChange={(e) => setGradientStart(e.target.value)}
                    style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'transparent' }}
                  />
                  <span style={{ fontSize: 12, color: '#9fbad0' }}>End</span>
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
            const c = isMeasure ? chipColors('measure') : chipColors('dimension');
            return (
              <div style={{ zIndex: 9999, pointerEvents: 'none' }}>
                <FieldChip name={activeId} bg={c.bg} border={c.border} text={c.text} dragging />
              </div>
            );
          })() : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
