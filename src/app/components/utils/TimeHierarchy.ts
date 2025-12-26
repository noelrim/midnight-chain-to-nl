// utils/TimeHierarchy.ts
import { TimePart, Row } from '../types/chart';

export class TimeHierarchy {
  static readonly TIME_PARTS: readonly TimePart[] = [
    'year', 'quarter', 'month', 'week', 'day', 'hour', 'minute', 'second'
  ] as const;

  static toDate(value: any): Date | null {
    if (value instanceof Date) return value;
    if (value == null) return null;
    const d = new Date(value);
    return isNaN(+d) ? null : d;
  }

  static extractTimePart(date: Date, part: TimePart): number {
    const y = date.getFullYear();
    const m = date.getMonth(); // 0..11
    
    switch (part) {
      case 'year': return y;
      case 'quarter': return Math.floor(m / 3) + 1;
      case 'month': return m + 1;
      case 'week': {
        const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = (t.getUTCDay() + 6) % 7;
        t.setUTCDate(t.getUTCDate() - dayNum + 3);
        const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
        return 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
      }
      case 'day': return date.getDate();
      case 'hour': return date.getHours();
      case 'minute': return date.getMinutes();
      case 'second': return date.getSeconds();
    }
  }

  static isVirtualTimeField(name?: string): { base: string; part: TimePart } | null {
    if (!name) return null;
    const idx = name.indexOf('::');
    if (idx === -1) return null;
    const part = name.slice(idx + 2) as TimePart;
    if (!this.TIME_PARTS.includes(part)) return null;
    return { base: name.slice(0, idx), part };
  }

  static getFieldValue(row: Row, fieldName?: string) {
    if (!fieldName) return undefined;
    const vt = this.isVirtualTimeField(fieldName);
    if (!vt) return row[fieldName];
    const date = this.toDate(row[vt.base]);
    if (!date) return undefined;
    return this.extractTimePart(date, vt.part);
  }

  static formatTimeLabel(part: TimePart, value: number): string {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    switch (part) {
      case 'month': return monthNames[Math.max(1, Math.min(12, value)) - 1];
      case 'quarter': return `Q${value}`;
      case 'hour': return `${value}:00`;
      case 'week': return `W${value}`;
      default: return String(value);
    }
  }
}

// Legacy compatibility exports
export const TIME_PARTS = TimeHierarchy.TIME_PARTS;

export function toDate(v: any): Date | null {
  return TimeHierarchy.toDate(v);
}

export function extractTimePart(d: Date, part: TimePart): number {
  return TimeHierarchy.extractTimePart(d, part);
}

export function isVirtualTimeField(name?: string): { base: string; part: TimePart } | null {
  return TimeHierarchy.isVirtualTimeField(name);
}

export function getFieldValue(row: Row, name?: string) {
  return TimeHierarchy.getFieldValue(row, name);
}

export function prettyTimeLabel(part: TimePart, v: number) {
  return TimeHierarchy.formatTimeLabel(part, v);
}