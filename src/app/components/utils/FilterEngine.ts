// utils/FilterEngine.ts
import { Row } from '../types/chart';
import { FilterCondition, DateFilter } from '../ChartJS';


export class FilterEngine {
  static applyFilters(rows: Row[], filters: FilterCondition[], dateFilters: DateFilter[]): Row[] {
    return rows.filter(row => {
      // Apply regular filters
      const passesFilters = filters.every(filter => this.evaluateCondition(row, filter));
      
      // Apply date filters
      const passesDateFilters = dateFilters.every(dateFilter => this.evaluateDateFilter(row, dateFilter));
      
      return passesFilters && passesDateFilters;
    });
  }

  private static evaluateCondition(row: Row, filter: FilterCondition): boolean {
    const value = row[filter.field];
    const filterValue = filter.value;

    switch (filter.operator) {
      case 'eq':
        return value == filterValue;
      case 'neq':
        return value != filterValue;
      case 'gt':
        return Number(value) > Number(filterValue);
      case 'lt':
        return Number(value) < Number(filterValue);
      case 'gte':
        return Number(value) >= Number(filterValue);
      case 'lte':
        return Number(value) <= Number(filterValue);
      case 'contains':
        return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
      case 'not_contains':
        return !String(value).toLowerCase().includes(String(filterValue).toLowerCase());
      case 'empty':
        return value == null || value === '' || value === undefined;
      case 'not_empty':
        return value != null && value !== '' && value !== undefined;
      case 'between':
        return Number(value) >= Number(filterValue) && Number(value) <= Number(filter.value2);
      default:
        return true;
    }
  }

// In FilterEngine.ts, replace the evaluateDateFilter method:
private static evaluateDateFilter(row: Row, filter: DateFilter): boolean {
  // Check if required date values are filled
  if (!filter.value) return true; // No date set = no filtering
  
  if (filter.operator === 'between' && !filter.value2) {
    return true; // Between requires both dates, if second is missing = no filtering
  }

  const value = new Date(row[filter.field]);
  if (isNaN(value.getTime())) return false;

  const filterDate = new Date(filter.value);
  if (isNaN(filterDate.getTime())) return true; // Invalid date = no filtering

  // Set times to start of day for date-only comparisons
  const rowDate = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const compareDate = new Date(filterDate.getFullYear(), filterDate.getMonth(), filterDate.getDate());

  switch (filter.operator) {
    case 'eq':
      return rowDate.getTime() === compareDate.getTime();
    case 'gt':
      return rowDate.getTime() > compareDate.getTime();
    case 'lt':
      return rowDate.getTime() < compareDate.getTime();
    case 'between':
      const endDate = new Date(filter.value2!);
      if (isNaN(endDate.getTime())) return true; // Invalid end date = no filtering
      const compareEndDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
      return rowDate.getTime() >= compareDate.getTime() && rowDate.getTime() <= compareEndDate.getTime();
    default:
      return true;
  }
}
}
