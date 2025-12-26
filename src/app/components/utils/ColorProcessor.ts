// utils/ColorProcessor.ts
export class ColorProcessor {
  static readonly SERIES_COLORS = [
    '#1f77b4', // blue
    '#e377c2', // pink-red
    '#2ca02c', '#ff7f0e', '#9467bd',
    '#8c564b', '#17becf', '#bcbd22',
    '#d62728', '#7f7f7f',
  ];

  static readonly BASE_BLUE = this.SERIES_COLORS[0];

  static withAlpha(hex: string, alpha = 0.35): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  static interpolateColor(val: number, min: number, max: number, lowHex: string, highHex: string): string {
    const t = (val - min) / (max - min || 1);
    const lr = parseInt(lowHex.slice(1, 3), 16);
    const lg = parseInt(lowHex.slice(3, 5), 16);
    const lb = parseInt(lowHex.slice(5, 7), 16);
    const hr = parseInt(highHex.slice(1, 3), 16);
    const hg = parseInt(highHex.slice(3, 5), 16);
    const hb = parseInt(highHex.slice(5, 7), 16);
    
    const r = Math.round(lr + t * (hr - lr));
    const g = Math.round(lg + t * (hg - lg));
    const b = Math.round(lb + t * (hb - lb));
    
    return `rgb(${r},${g},${b})`;
  }

  static generateColorArray(
    values: number[],
    mode: 'hue' | 'alpha',
    vmin: number,
    vmax: number,
    startHex: string,
    endHex: string
  ): string[] {
    return values.map(v => {
      const t = (v - vmin) / (vmax - vmin || 1);
      if (mode === 'alpha') {
        const a = 0.25 + t * (0.9 - 0.25);
        return this.withAlpha(startHex || this.BASE_BLUE, a);
      }
      return this.interpolateColor(v, vmin, vmax, startHex || '#c8e6c9', endHex || '#e377c2');
    });
  }

  static getSeriesColor(index: number): string {
    return this.SERIES_COLORS[index % this.SERIES_COLORS.length];
  }
}

// Legacy compatibility exports
export const SERIES_COLORS = ColorProcessor.SERIES_COLORS;
export const BASE_BLUE = ColorProcessor.BASE_BLUE;

export function withAlpha(hex: string, alpha = 0.35): string {
  return ColorProcessor.withAlpha(hex, alpha);
}

export function interpolateColor(val: number, min: number, max: number, lowHex: string, highHex: string): string {
  return ColorProcessor.interpolateColor(val, min, max, lowHex, highHex);
}

export function colorArrayFromValues(
  vals: number[],
  mode: 'hue' | 'alpha',
  vmin: number,
  vmax: number,
  startHex: string,
  endHex: string
): string[] {
  return ColorProcessor.generateColorArray(vals, mode, vmin, vmax, startHex, endHex);
}