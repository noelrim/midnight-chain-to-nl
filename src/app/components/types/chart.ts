// types/chart.ts
export type Row = Record<string, any>;

export interface Field {
  name: string;
  type: 'quantitative' | 'temporal' | 'nominal' | 'ordinal';
  displayName?: string;
}

export interface EncodingSlots {
  x?: string;
  y: string[];
  color?: string;
  size?: string;
  row?: string;
  column?: string;
}

export type MarkType = 'bar' | 'bar-stacked' | 'line' | 'area' | 'point' | 'pie' | 'heatmap';

export interface ChartConfig {
  mark: MarkType;
  encoding: EncodingSlots;
  colorScaleMode: 'hue' | 'alpha';
  gradientStart: string;
  gradientEnd: string;
}

export interface ChartState {
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
 filters: FilterCondition[];
  setFilters: (filters: FilterCondition[] | ((prev: FilterCondition[]) => FilterCondition[])) => void;
  dateFilters: DateFilter[];
  setDateFilters: (filters: DateFilter[] | ((prev: DateFilter[]) => DateFilter[])) => void;
}

export type TimePart = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';