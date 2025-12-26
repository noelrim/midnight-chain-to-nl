// utils/DataProcessor.ts
import { Field, Row } from '../types/chart';

export class DataProcessor {
  static inferFieldType(values: any[]): Field['type'] {
    const sample = values.find((v) => v !== null && v !== undefined);
    if (sample instanceof Date) return 'temporal';
    if (typeof sample === 'string') {
      if (/^\d{4}-\d{2}-\d{2}/.test(sample)) return 'temporal';
      if (/^-?\d+(\.\d+)?$/.test(sample)) return 'quantitative';
      return 'nominal';
    }
    if (typeof sample === 'number') return 'quantitative';
    return 'nominal';
  }

  static buildFieldCatalog(rows: Row[]): Field[] {
    if (!rows?.length) return [];
    const keys = Object.keys(rows[0]);
    return keys.map((key) => ({
      name: key,
      type: this.inferFieldType(rows.map((r) => r[key])),
      displayName: this.formatFieldName(key)
    }));
  }

  static formatFieldName(name: string): string {
    return name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  static categorizeFields(fields: Field[]) {
    return {
      dimensions: fields.filter((f) => f.type !== 'quantitative'),
      measures: fields.filter((f) => f.type === 'quantitative')
    };
  }

  static sortLabels(labels: any[], type: Field['type']) {
    if (type === 'temporal') {
      return labels.slice().sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
    }
    if (type === 'quantitative') {
      return labels.slice().sort((a, b) => Number(a) - Number(b));
    }
    return labels.slice().sort((a, b) => String(a).localeCompare(String(b)));
  }

  static unique<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
  }
}

// Legacy compatibility - export functions for current implementation
export function inferType(values: any[]): Field['type'] {
  return DataProcessor.inferFieldType(values);
}

export function buildCatalog(rows: Row[]): Field[] {
  return DataProcessor.buildFieldCatalog(rows);
}

export function sortLabels(labels: any[], type: Field['type']) {
  return DataProcessor.sortLabels(labels, type);
}

export function unique<T>(arr: T[]): T[] {
  return DataProcessor.unique(arr);
}