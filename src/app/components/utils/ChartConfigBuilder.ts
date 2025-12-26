// utils/ChartConfigBuilder.ts
import { EncodingSlots, Field, MarkType } from '../types/chart';
import { TimeHierarchy } from './TimeHierarchy';

export class ChartConfigBuilder {
  static recommendMark(encoding: EncodingSlots, fields: Field[]): MarkType {
    const typeOf = (name?: string) => fields.find((f) => f.name === name)?.type;
    const x = typeOf(encoding.x);
    
    if ((encoding.y?.length ?? 0) > 1) return 'line';
    
    const y = typeOf(encoding.y?.[0]);
    if (x === 'temporal' && y === 'quantitative') return 'line';
    if (x === 'nominal' && y === 'quantitative') return 'bar';
    if (x === 'quantitative' && y === 'quantitative') return 'point';
    
    return 'bar';
  }

  static getScaleType(fieldName: string, fields: Field[]): 'time' | 'linear' | 'category' {
    const vt = TimeHierarchy.isVirtualTimeField(fieldName);
    if (vt) return 'linear';
    
    const field = fields.find(f => f.name === fieldName);
    if (!field) return 'category';
    
    switch (field.type) {
      case 'temporal': return 'time';
      case 'quantitative': return 'linear';
      default: return 'category';
    }
  }

  static chipColors(kind: 'dimension' | 'measure') {
    return kind === 'dimension'
      ? { bg: '#ffecb3', border: '#fbc02d', text: '#5d4037' }
      : { bg: '#c8e6c9', border: '#388e3c', text: '#1b5e20' };
  }
}

// Legacy compatibility export
export function recommendedMark(enc: EncodingSlots, fields: Field[]): MarkType {
  return ChartConfigBuilder.recommendMark(enc, fields);
}

export function chipColors(kind: 'dimension' | 'measure') {
  return ChartConfigBuilder.chipColors(kind);
}