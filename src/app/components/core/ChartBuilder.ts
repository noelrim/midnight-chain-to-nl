// core/ChartBuilder.ts
import { Row, Field, EncodingSlots, ChartConfig, MarkType } from '../types/chart';
import { DataProcessor } from '../utils/DataProcessor';
import { TimeHierarchy } from '../utils/TimeHierarchy';
import { ColorProcessor } from '../utils/ColorProcessor';
import { ChartConfigBuilder } from '../utils/ChartConfigBuilder';

export class ChartBuilder {
  private rows: Row[];
  private fields: Field[];
  private config: ChartConfig;

  constructor(rows: Row[]) {
    this.rows = rows;
    this.fields = DataProcessor.buildFieldCatalog(rows);
    this.config = {
      mark: 'bar',
      encoding: { y: [] },
      colorScaleMode: 'hue',
      gradientStart: '#07003d',
      gradientEnd: '#bd0f89'
    };
  }

  // Fluent API for configuration
  setEncoding(encoding: Partial<EncodingSlots>): this {
    this.config.encoding = { ...this.config.encoding, ...encoding };
    return this;
  }

  setMark(mark: MarkType): this {
    this.config.mark = mark;
    return this;
  }

  setColorMode(mode: 'hue' | 'alpha'): this {
    this.config.colorScaleMode = mode;
    return this;
  }

  setColorGradient(start: string, end: string): this {
    this.config.gradientStart = start;
    this.config.gradientEnd = end;
    return this;
  }

  autoMark(): this {
    this.config.mark = ChartConfigBuilder.recommendMark(this.config.encoding, this.fields);
    return this;
  }

  // Getters
  getRows(): Row[] {
    return [...this.rows];
  }

  getFields(): Field[] {
    return [...this.fields];
  }

  getCategorizedFields() {
    return DataProcessor.categorizeFields(this.fields);
  }

  getConfig(): ChartConfig {
    return { ...this.config };
  }

  getEncoding(): EncodingSlots {
    return { ...this.config.encoding };
  }

  // Add/remove fields from encoding
  addToY(fieldName: string): this {
    if (!this.config.encoding.y.includes(fieldName)) {
      this.config.encoding.y = [...this.config.encoding.y, fieldName];
    }
    return this;
  }

  removeFromY(fieldName: string): this {
    this.config.encoding.y = this.config.encoding.y.filter(name => name !== fieldName);
    return this;
  }

  setX(fieldName?: string): this {
    this.config.encoding.x = fieldName;
    return this;
  }

  setColor(fieldName?: string): this {
    this.config.encoding.color = fieldName;
    return this;
  }

  setSize(fieldName?: string): this {
    this.config.encoding.size = fieldName;
    return this;
  }

  // Validation (now more lenient for UI building)
  validate(): { isValid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if fields exist (this is an error)
    const allEncodedFields = [
      this.config.encoding.x,
      ...this.config.encoding.y,
      this.config.encoding.color,
      this.config.encoding.size
    ].filter(Boolean) as string[];

    for (const fieldName of allEncodedFields) {
      const exists = this.fields.some(f => f.name === fieldName) || 
                    fieldName.includes('::'); // Virtual time fields
      if (!exists) {
        errors.push(`Field "${fieldName}" does not exist in the data`);
      }
    }

    // These are warnings for incomplete configurations (not errors)
    if (this.config.encoding.y.length === 0 && this.config.mark !== 'pie') {
      warnings.push('At least one Y field recommended for most charts');
    }

    if (this.config.mark === 'pie') {
      const hasCategory = this.config.encoding.x || this.config.encoding.color;
      if (!hasCategory) {
        warnings.push('Pie charts work better with X or Color field for categories');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // Strict validation for when you want to ensure completeness
  validateStrict(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Must have at least one Y field for most charts
    if (this.config.encoding.y.length === 0 && this.config.mark !== 'pie') {
      errors.push('At least one Y field is required');
    }

    // Pie charts need either X or Color for categories
    if (this.config.mark === 'pie') {
      const hasCategory = this.config.encoding.x || this.config.encoding.color;
      if (!hasCategory) {
        errors.push('Pie charts require either X or Color field for categories');
      }
    }

    // Check if fields exist
    const allEncodedFields = [
      this.config.encoding.x,
      ...this.config.encoding.y,
      this.config.encoding.color,
      this.config.encoding.size
    ].filter(Boolean) as string[];

    for (const fieldName of allEncodedFields) {
      const exists = this.fields.some(f => f.name === fieldName) || 
                    fieldName.includes('::'); // Virtual time fields
      if (!exists) {
        errors.push(`Field "${fieldName}" does not exist in the data`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Main render method with ALL Chart.js logic
  render() {
    const { encoding: enc, mark, colorScaleMode, gradientStart, gradientEnd } = this.config;
    const { rows, fields } = this;

    // Handle empty/incomplete configurations gracefully for UI building
    if (!enc.y || enc.y.length === 0) {
      // Return empty chart for incomplete configurations
      return {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { 
            legend: { position: 'top' }, 
            tooltip: { enabled: true },
            title: { 
              display: true, 
              text: 'Add fields to Y axis to create chart',
              color: '#9fbad0',
              font: { size: 14 }
            }
          }
        }
      };
    }

    const xField = enc.x;
    const yFields = enc.y ?? [];
    const colorField = enc.color;
    const isStacked = mark === 'bar-stacked';

    // Using TimeHierarchy module for time processing
    const xVirt = TimeHierarchy.isVirtualTimeField(xField);
    const rawX = xField
      ? rows.map(r => TimeHierarchy.getFieldValue(r, xField))
      : rows.map((_, i) => i);

    // Using DataProcessor for label processing
    let labels: any[] = [];
    if (xField) {
      if (xVirt) {
        const nums = DataProcessor.unique(rawX.filter(v => v !== undefined) as number[]);
        labels = nums.sort((a,b) => Number(a) - Number(b));
      } else {
        const xBaseType = fields.find(f => f.name === xField)?.type ?? 'nominal';
        labels = DataProcessor.sortLabels(DataProcessor.unique(rawX), xBaseType as Field['type']);
      }
    } else {
      labels = rawX;
    }

    const typeOf = (n?: string) => fields.find((f) => f.name === n)?.type;

    // PIE CHART
    if (mark === 'pie') {
      const categoryField = [enc.x, enc.color].find(n => n && typeOf(n) !== 'quantitative');
      const valueField = (enc.size && typeOf(enc.size) === 'quantitative' ? enc.size : yFields[0]) as string | undefined;

      if (!categoryField || !valueField) {
        return { 
          type: 'pie', 
          data: { labels: [], datasets: [] }, 
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { 
                display: true, 
                text: 'Add X or Color field for pie chart categories',
                color: '#9fbad0',
                font: { size: 14 }
              }
            }
          }
        };
      }

      const catType = typeOf(categoryField) ?? 'nominal';
      const pieLabels = DataProcessor.sortLabels(DataProcessor.unique(rows.map(r => r[categoryField as string])), catType);

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
        const colors = ColorProcessor.generateColorArray(colorVals, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);
        backgroundColor = colors;
        borderColor = colors;
      } else {
        backgroundColor = pieLabels.map((_, i) => ColorProcessor.withAlpha(ColorProcessor.getSeriesColor(i), 0.7));
        borderColor = pieLabels.map((_, i) => ColorProcessor.getSeriesColor(i));
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
      };
    }

    // HEATMAP (matrix) - restored from original implementation
    if (mark === 'heatmap') {
      const xDim = enc.x;
      if (!xDim) {
        return { 
          type: 'matrix', 
          data: { labels: [], datasets: [] }, 
          options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
              title: { 
                display: true, 
                text: 'Add X field for heatmap',
                color: '#9fbad0',
                font: { size: 14 }
              }
            }
          } 
        };
      }

      const yDim = (enc.y || []).find(n => typeOf(n) !== 'quantitative') ?? (enc.y?.[0]);
      const valueField =
        (enc.color && typeOf(enc.color) === 'quantitative')
          ? enc.color
          : (enc.y || []).find(n => typeOf(n) === 'quantitative');

      if (!yDim || !valueField) {
        return { 
          type: 'matrix', 
          data: { labels: [], datasets: [] }, 
          options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
              title: { 
                display: true, 
                text: 'Add categorical Y field and quantitative field for heatmap',
                color: '#9fbad0',
                font: { size: 14 }
              }
            }
          } 
        };
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

      const xVals = rows.map(r => normDay(TimeHierarchy.getFieldValue(r, xDim)));
      const yVals = rows.map(r => normRow(TimeHierarchy.getFieldValue(r, yDim)));

      const xLabels = DataProcessor.sortLabels(DataProcessor.unique(xVals), 'nominal');
      const yLabels = (yT === 'quantitative')
        ? Array.from(new Set(yVals as number[])).sort((a,b) => Number(a) - Number(b))
        : DataProcessor.sortLabels(DataProcessor.unique(yVals), 'nominal');

      const xIndex = new Map(xLabels.map((v, i) => [v, i]));
      const yIndex = new Map(yLabels.map((v, i) => [v, i]));

      const grid = Array.from({ length: yLabels.length }, () => new Array<number>(xLabels.length).fill(0));
      for (const r of rows) {
        const xi = xIndex.get(normDay(TimeHierarchy.getFieldValue(r, xDim)));
        const yi = yIndex.get(normRow(TimeHierarchy.getFieldValue(r, yDim)));
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
          const xi = xIndex.get(normDay(TimeHierarchy.getFieldValue(r, xDim)));
          const yi = yIndex.get(normRow(TimeHierarchy.getFieldValue(r, yDim)));
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
          return ColorProcessor.withAlpha(gradientStart || '#1f77b4', a);
        }
        return ColorProcessor.interpolateColor(val, vmin, vmax, gradientStart || '#c8e6c9', gradientEnd || '#e377c2');
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
      };
    }

    // BAR/LINE/AREA/SCATTER (simplified logic using modules)
    const datasets: any[] = [];
    const colorIsMeasure = colorField && typeOf(colorField) === 'quantitative';

    if (colorIsMeasure) {
      const isBar = mark === 'bar' || mark === 'bar-stacked';

      if (xField) {
        const labelIndex = new Map<any, number>();
        labels.forEach((v, i) => labelIndex.set(v, i));

        const seriesByY = yFields.map(() => new Array(labels.length).fill(0));
        const colorSeries = new Array(labels.length).fill(0);

        for (const r of rows) {
          const xi = labelIndex.get(TimeHierarchy.getFieldValue(r, xField)!);
          if (xi === undefined) continue;
          for (let yi = 0; yi < yFields.length; yi++) {
            seriesByY[yi][xi] += Number(r[yFields[yi]] ?? 0);
          }
          colorSeries[xi] += Number(r[colorField!] ?? 0);
        }

        const cmin = Math.min(...colorSeries);
        const cmax = Math.max(...colorSeries);
        const colors = ColorProcessor.generateColorArray(colorSeries, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);

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
            base.backgroundColor = ColorProcessor.withAlpha('#9fbad0', mark === 'area' ? 0.25 : 0.15);
            base.pointBackgroundColor = colors;
            base.pointBorderColor = colors;
          }

          datasets.push(base);
        }
      } else {
        // No X field - treat each row as a data point
        const colorSeries = rows.map(r => Number(r[colorField!] ?? 0));
        const cmin = Math.min(...colorSeries);
        const cmax = Math.max(...colorSeries);
        const colors = ColorProcessor.generateColorArray(colorSeries, colorScaleMode, cmin, cmax, gradientStart, gradientEnd);

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
            base.backgroundColor = ColorProcessor.withAlpha('#9fbad0', mark === 'area' ? 0.25 : 0.15);
            base.pointBackgroundColor = colors;
            base.pointBorderColor = colors;
          }

          datasets.push(base);
        }
      }
    } else if (colorField) {
      const cats = DataProcessor.sortLabels(DataProcessor.unique(rows.map(r => r[colorField])), 'nominal');
      for (let yi = 0; yi < yFields.length; yi++) {
        const y = yFields[yi];
        const perCat: Record<string, number[]> = {};
        for (const c of cats) perCat[c] = new Array(labels.length).fill(0);
        for (const r of rows) {
          const xi = xField ? labels.indexOf(TimeHierarchy.getFieldValue(r, xField)) : -1;
          const c = r[colorField];
          if (xi >= 0 && c in perCat) perCat[c][xi] += Number(r[y] ?? 0);
        }
        cats.forEach((c, ci) => {
          const color = ColorProcessor.getSeriesColor(ci);
          const base = {
            label: `${y} • ${c}`,
            data: perCat[c],
            fill: mark === 'area',
            showLine: mark !== 'point' && !(mark === 'bar' || mark === 'bar-stacked'),
            pointRadius: mark === 'point' ? 3 : ((mark === 'bar' || mark === 'bar-stacked') ? 0 : 2),
            tension: 0.25,
            stack: isStacked ? 'stack1' : undefined,
            backgroundColor: mark === 'bar' || mark === 'bar-stacked' 
              ? ColorProcessor.withAlpha(color, 0.6) 
              : ColorProcessor.withAlpha(color, mark === 'area' ? 0.3 : 0.15),
            borderColor: color,
            borderWidth: mark === 'bar' || mark === 'bar-stacked' ? 1 : 2,
          };
          datasets.push(base);
        });
      }
    } else {
      // No color field - simple series
      for (let yi = 0; yi < yFields.length; yi++) {
        const y = yFields[yi];
        const series = new Array(labels.length).fill(0);
        for (const r of rows) {
          const xi = xField ? labels.indexOf(TimeHierarchy.getFieldValue(r, xField)) : -1;
          if (xi >= 0) series[xi] += Number(r[y] ?? 0);
        }
        const color = ColorProcessor.getSeriesColor(yi);
        const base = {
          label: y,
          data: series,
          fill: mark === 'area',
          showLine: mark !== 'point' && !(mark === 'bar' || mark === 'bar-stacked'),
          pointRadius: mark === 'point' ? 3 : ((mark === 'bar' || mark === 'bar-stacked') ? 0 : 2),
          tension: 0.25,
          stack: isStacked ? 'stack1' : undefined,
          backgroundColor: mark === 'bar' || mark === 'bar-stacked' 
            ? ColorProcessor.withAlpha(color, 0.6) 
            : ColorProcessor.withAlpha(color, mark === 'area' ? 0.3 : 0.15),
          borderColor: color,
          borderWidth: mark === 'bar' || mark === 'bar-stacked' ? 1 : 2,
        };
        datasets.push(base);
      }
    }

    const xScaleType = xVirt ? 'linear' : ChartConfigBuilder.getScaleType(xField || '', fields);

    const type =
      (mark === 'bar' || mark === 'bar-stacked') ? 'bar' :
      mark === 'point' ? 'scatter' :
      'line';

    return {
      type,
      data: { 
        labels: labels.map(label => {
          if (xVirt && typeof label === 'number') {
            return TimeHierarchy.formatTimeLabel(xVirt.part, label);
          }
          return label;
        }), 
        datasets 
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            enabled: true,
            ...(xVirt && {
              callbacks: {
                title: (items: any[]) => {
                  const i = items[0]?.dataIndex ?? 0;
                  const v = labels[i];
                  return TimeHierarchy.formatTimeLabel(xVirt.part, Number(v));
                }
              }
            })
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
              // Only override callback for virtual time fields
              ...(xVirt && {
                callback: (val: any) => {
                  const i = Math.round(Number(val));
                  const lab = labels[i];
                  return lab == null ? '' : TimeHierarchy.formatTimeLabel(xVirt.part, Number(lab));
                }
              })
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
    };
  }

  // Create a copy with modifications
  clone(): ChartBuilder {
    const clone = new ChartBuilder(this.rows);
    clone.config = { ...this.config, encoding: { ...this.config.encoding } };
    return clone;
  }

  // Export configuration for serialization
  toJSON() {
    return {
      config: this.config,
      fieldCount: this.fields.length,
      rowCount: this.rows.length
    };
  }

  // Import configuration
  static fromJSON(rows: Row[], jsonConfig: any): ChartBuilder {
    const builder = new ChartBuilder(rows);
    if (jsonConfig.config) {
      builder.config = { ...builder.config, ...jsonConfig.config };
    }
    return builder;
  }
}

// Factory function for easier usage
export function createChartBuilder(rows: Row[]): ChartBuilder {
  return new ChartBuilder(rows);
}