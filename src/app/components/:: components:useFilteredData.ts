// components/useFilteredData.ts
import { useMemo } from 'react';
import { useChartCtx } from './ChartJS';

export function useFilteredData<T extends Record<string, any>>(originalData: T[]) {
  const { filters, dateFilters } = useChartCtx();
  
  return useMemo(() => {
    if (!filters.length && !dateFilters.length) {
      return originalData;
    }
    
    // Apply the same FilterEngine logic here
    return FilterEngine.applyFilters(originalData, filters, dateFilters);
  }, [originalData, filters, dateFilters]);
}