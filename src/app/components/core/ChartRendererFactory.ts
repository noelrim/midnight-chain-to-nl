// core/ChartRendererFactory.ts
import { Row, Field, ChartConfig, MarkType } from '../types/chart';
import { DataProcessor } from '../utils/DataProcessor';
import { TimeHierarchy } from '../utils/TimeHierarchy';
import { ColorProcessor } from '../utils/ColorProcessor';

// Abstract base class for chart renderers
export abstract class ChartRenderer {
  abstract render(
    rows: Row[],
    config: ChartConfig,
    fields: Field[]
  ): any; // Chart.js config object

  protected getLabels(rows: Row[], xField?: string, fields: Field[]): any[] {
    if (!xField) return rows.map((_, i) => i);

    const vt = TimeHierarchy.isVirtualTimeField(xField);
    const rawValues = rows.map(r => TimeHierarchy.getFieldValue(r, xField));

    if (vt) {
      const numbers = DataProcessor.unique(rawValues.filter(v => v !== undefined) as number[]);
      return numbers.sort((a, b) => Number(a) - Number(b));
    }

    const fieldType = fields.find(f => f.name === xField)?.type ?? 'nominal';
    return DataProcessor.sortLabels(DataProcessor.unique(rawValues), fieldType);
  }

  protected formatLabel(label: any, xField?: string): string {
    const vt = TimeHierarchy.isVirtualTimeField(xField);
    if (vt && typeof label === 'number') {
      return TimeHierarchy.formatTimeLabel(vt.part, label);
    }
    return String(label);
  }

  protected getFieldType(fieldName: string, fields: Field[]): Field['type'] | undefined {
    return fields.find(f => f.name === fieldName)?.type;
  }

  protected buildBaseDataset(mark: string, color: string) {
    const isBar = mark === 'bar' || mark === 'bar-stacked';
    const isArea = mark === 'area';
    const isPoint = mark === 'point';

    return {
      borderColor: color,
      backgroundColor: isBar 
        ? ColorProcessor.withAlpha(color, 0.6) 
        : ColorProcessor.withAlpha(color, isArea ? 0.3 : 0.15),
      borderWidth: isBar ? 1 : 2,
      fill: isArea,
      showLine: !isBar && !isPoint,
      pointRadius: isPoint ? 3 : (isBar ? 0 : 2),
      tension: 0.25
    };
  }
}

// Concrete implementations for different chart types
export class BarChartRenderer extends ChartRenderer {
  render(rows: Row[], config: ChartConfig, fields: Field[]) {
    const { encoding, mark } = config;
    const labels = this.getLabels(rows, encoding.x, fields);
    const isStacked = mark === 'bar-stacked';
    
    const datasets = this.buildDatasets(rows, config, fields, labels);
    
    return {
      type: 'bar',
      data: { 
        labels: labels.map(label => this.formatLabel(label, encoding.x)), 
        datasets 
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: isStacked,
            grid: { display: false }
          },
          y: {
            stacked: isStacked,
            beginAtZero: isStacked,
            grid: { color: 'rgba(148,163,184,0.2)' }
          }
        },
        plugins: {
          legend: { position: 'top' as const },
          tooltip: { enabled: true }
        }
      }
    };
  }

  private buildDatasets(rows: Row[], config: ChartConfig, fields: Field[], labels: any[]) {
    const { encoding, mark, colorScaleMode, gradientStart, gradientEnd } = config;
    const datasets: any[] = [];
    const isStacked = mark === 'bar-stacked';

    for (let yi = 0; yi < encoding.y.length; yi++) {
      const yField = encoding.y[yi];
      const series = new Array(labels.length).fill(0);
      
      for (const row of rows) {
        const xi = encoding.x ? labels.indexOf(TimeHierarchy.getFieldValue(row, encoding.x)) : -1;
        if (xi >= 0) series[xi] += Number(row[yField] ?? 0);
      }

      const color = ColorProcessor.getSeriesColor(yi);
      datasets.push({
        label: yField,
        data: series,
        ...this.buildBaseDataset(mark, color),
        stack: isStacked ? 'stack1' : undefined,
      });
    }

    return datasets;
  }
}

export class LineChartRenderer extends ChartRenderer {
  render(rows: Row[], config: ChartConfig, fields: Field[]) {
    const { encoding, mark } = config;
    const labels = this.getLabels(rows, encoding.x, fields);
    const datasets = this.buildDatasets(rows, config, fields, labels);
    
    return {
      type: 'line',
      data: { 
        labels: labels.map(label => this.formatLabel(label, encoding.x)), 
        datasets 
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            grid: { display: false }
          },
          y: {
            grid: { color: 'rgba(148,163,184,0.2)' }
          }
        },
        plugins: {
          legend: { position: 'top' as const },
          tooltip: { enabled: true },
          zoom: { 
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, 
            pan: { enabled: true, mode: 'x' } 
          }
        }
      }
    };
  }

  private buildDatasets(rows: Row[], config: ChartConfig, fields: Field[], labels: any[]) {
    const { encoding, mark } = config;
    const datasets: any[] = [];

    for (let yi = 0; yi < encoding.y.length; yi++) {
      const yField = encoding.y[yi];
      const series = new Array(labels.length).fill(0);
      
      for (const row of rows) {
        const xi = encoding.x ? labels.indexOf(TimeHierarchy.getFieldValue(row, encoding.x)) : -1;
        if (xi >= 0) series[xi] += Number(row[yField] ?? 0);
      }

      const color = ColorProcessor.getSeriesColor(yi);
      datasets.push({
        label: yField,
        data: series,
        ...this.buildBaseDataset(mark, color),
      });
    }

    return datasets;
  }
}

export class PieChartRenderer extends ChartRenderer {
  render(rows: Row[], config: ChartConfig, fields: Field[]) {
    const { encoding } = config;
    
    // Determine category and value fields
    const categoryField = [encoding.x, encoding.color].find(n => 
      n && this.getFieldType(n, fields) !== 'quantitative'
    );
    const valueField = (encoding.size && this.getFieldType(encoding.size, fields) === 'quantitative' 
      ? encoding.size 
      : encoding.y[0]) as string | undefined;

    if (!categoryField || !valueField) {
      return { type: 'pie', data: { labels: [], datasets: [] }, options: {} };
    }

    const categories = DataProcessor.unique(rows.map(r => r[categoryField]));
    const values = categories.map(cat =>
      rows
        .filter(r => r[categoryField] === cat)
        .reduce((sum, r) => sum + (Number(r[valueField!]) || 0), 0)
    );

    const colors = categories.map((_, i) => ColorProcessor.getSeriesColor(i));

    return {
      type: 'pie',
      data: {
        labels: categories,
        datasets: [{
          label: valueField,
          data: values,
          backgroundColor: colors.map(c => ColorProcessor.withAlpha(c, 0.7)),
          borderColor: colors,
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { position: 'right' as const }, 
          tooltip: { enabled: true } 
        }
      }
    };
  }
}

export class ScatterChartRenderer extends ChartRenderer {
  render(rows: Row[], config: ChartConfig, fields: Field[]) {
    const { encoding } = config;
    const datasets = this.buildScatterDatasets(rows, config, fields);
    
    return {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'linear',
            title: { display: true, text: encoding.x || 'X' }
          },
          y: {
            type: 'linear',
            title: { display: true, text: encoding.y[0] || 'Y' }
          }
        },
        plugins: {
          legend: { position: 'top' as const },
          tooltip: { enabled: true }
        }
      }
    };
  }

  private buildScatterDatasets(rows: Row[], config: ChartConfig, fields: Field[]) {
    const { encoding } = config;
    const datasets: any[] = [];

    if (!encoding.x || !encoding.y[0]) return datasets;

    const data = rows.map(row => ({
      x: TimeHierarchy.getFieldValue(row, encoding.x!),
      y: Number(row[encoding.y[0]] ?? 0)
    })).filter(point => point.x !== undefined && !isNaN(point.y));

    const color = ColorProcessor.getSeriesColor(0);
    datasets.push({
      label: `${encoding.y[0]} vs ${encoding.x}`,
      data,
      backgroundColor: ColorProcessor.withAlpha(color, 0.6),
      borderColor: color,
      pointRadius: 3,
    });

    return datasets;
  }
}

// Factory class
export class ChartRendererFactory {
  private static renderers: Map<MarkType, ChartRenderer> = new Map([
    ['bar', new BarChartRenderer()],
    ['bar-stacked', new BarChartRenderer()],
    ['line', new LineChartRenderer()],
    ['area', new LineChartRenderer()],
    ['point', new ScatterChartRenderer()],
    ['pie', new PieChartRenderer()],
    // Add heatmap when needed
  ]);

  static getRenderer(mark: MarkType): ChartRenderer {
    const renderer = this.renderers.get(mark);
    if (!renderer) {
      throw new Error(`No renderer found for mark type: ${mark}`);
    }
    return renderer;
  }

  static registerRenderer(mark: MarkType, renderer: ChartRenderer): void {
    this.renderers.set(mark, renderer);
  }

  static getAvailableRenderers(): MarkType[] {
    return Array.from(this.renderers.keys());
  }
}