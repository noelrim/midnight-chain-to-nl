// components/FilterControls.tsx
import React, { useState }  from 'react';
import { useChartCtx, FilterCondition, DateFilter } from './ChartJS';
import { Field } from './types/chart';

export function FilterControls() {
  const { fields, filters, setFilters, dateFilters, setDateFilters } = useChartCtx();

  // Check if there are any temporal fields
  const temporalFields = fields.filter(f => f.type === 'temporal');
  const hasTemporalFields = temporalFields.length > 0;

  const addFilter = () => {
    const newFilter: FilterCondition = {
      id: crypto.randomUUID(),
      field: fields[0]?.name || '',
      operator: 'eq',
      value: ''
    };
    setFilters(prev => [...prev, newFilter]);
  };

  const addDateFilter = () => {
    const newDateFilter: DateFilter = {
      id: crypto.randomUUID(),
      field: temporalFields[0]?.name || '',
      operator: 'eq',
      value: new Date()
    };
    setDateFilters(prev => [...prev, newDateFilter]);
  };


  const removeFilter = (id: string) => {
    setFilters(prev => prev.filter(f => f.id !== id));
  };

  const removeDateFilter = (id: string) => {
    setDateFilters(prev => prev.filter(f => f.id !== id));
  };

  const updateFilter = (id: string, updates: Partial<FilterCondition>) => {
    setFilters(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const updateDateFilter = (id: string, updates: Partial<DateFilter>) => {
    setDateFilters(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
  };

return (
    <div style={{ marginTop: 12, borderTop: '1px solid #2d3648', paddingTop: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Filters</div>
      
      {filters.map(filter => (
        <FilterRow 
          key={filter.id}
          filter={filter}
          fields={fields}
          onUpdate={(updates) => updateFilter(filter.id, updates)}
          onRemove={() => removeFilter(filter.id)}
        />
      ))}

      {dateFilters.map(dateFilter => (
        <DateFilterRow
          key={dateFilter.id}
          filter={dateFilter}
          fields={temporalFields}
          onUpdate={(updates) => updateDateFilter(dateFilter.id, updates)}
          onRemove={() => removeDateFilter(dateFilter.id)}
        />
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={addFilter} className="btn secondary" style={{ fontSize: '12px', padding: '4px 8px' }}>+ Filter</button>
        {hasTemporalFields && (
          <button onClick={addDateFilter} className="btn secondary" style={{ fontSize: '12px', padding: '4px 8px' }}>+ Date Filter</button>
        )}
      </div>
    </div>
  );
}

function FilterRow({ filter, fields, onUpdate, onRemove }: {
  filter: FilterCondition;
  fields: Field[];
  onUpdate: (updates: Partial<FilterCondition>) => void;
  onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsEditing(false);
    }
  };

  const getOperatorSymbol = (op: string) => {
    const symbols = {
      'eq': '=',
      'neq': '≠',
      'gt': '>',
      'lt': '<',
      'gte': '≥',
      'lte': '≤',
      'contains': 'contains',
      'not_contains': 'not contains',
      'empty': 'is empty',
      'not_empty': 'is not empty',
      'between': 'between'
    };
    return symbols[op as keyof typeof symbols] || op;
  };

  const baseBackgroundColor = '#23293a';
  const hoverBackgroundColor = '#2a3142';

  return (
    <div 
      style={{ 
        display: 'flex', 
        gap: 8, 
        alignItems: 'center', 
        marginBottom: 8, 
        padding: '8px', 
        background: isHovered ? hoverBackgroundColor : baseBackgroundColor,
        borderRadius: '6px', 
        flexWrap: 'wrap',
        position: 'relative',
        cursor: isEditing ? 'default' : 'pointer',
        transition: 'background-color 0.2s ease',
        minHeight: '40px'
      }}
      onClick={() => !isEditing && setIsEditing(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={handleBlur}
      tabIndex={0}
      title={isEditing ? undefined : "Click to edit"}
    >
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{ 
          color: '#ef4444', 
          background: 'none', 
          border: 'none', 
          cursor: 'pointer',
          fontSize: '16px',
          position: 'absolute', 
          top: 5,
          right: 5
        }}
      >
        ×
      </button>

      {isEditing ? (
        // Edit mode - show inputs
        <>
          <select 
            value={filter.field}
            onChange={(e) => onUpdate({ field: e.target.value })}
            className="chart-select"
            style={{ 
              padding: '5px 0 5px 0', 
              fontSize: '12px', 
              width: '100px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: '2px dotted #0f1420cc', 
              borderRadius: '0' 
            }}
            autoFocus
          >
            {fields.map(f => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>

          <select
            value={filter.operator}
            onChange={(e) => onUpdate({ operator: e.target.value as any })}
            className="chart-select"
            style={{ 
              padding: '5px 0 5px 0', 
              fontSize: '12px', 
              width: '100px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: '2px dotted #0f1420cc', 
              borderRadius: '0' 
            }}
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="gte">≥</option>
            <option value="lte">≤</option>
            <option value="contains">contains</option>
            <option value="not_contains">not contains</option>
            <option value="empty">is empty</option>
            <option value="not_empty">is not empty</option>
            <option value="between">between</option>
          </select>

          {!['empty', 'not_empty'].includes(filter.operator) && (
            <input
              type="text"
              value={filter.value || ''}
              onChange={(e) => onUpdate({ value: e.target.value })}
              className="input"
              style={{ 
                padding: '5px 0 5px 0', 
                fontSize: '12px', 
                width: '100px', 
                background: 'transparent', 
                border: 'none', 
                borderBottom: '2px dotted #0f1420cc', 
                borderRadius: '0' 
              }}
              placeholder="Value"
            />
          )}

          {filter.operator === 'between' && (
            <>
              <span>and</span>
              <input
                type="text"
                value={filter.value2 || ''}
                onChange={(e) => onUpdate({ value2: e.target.value })}
                className="input"
                style={{ 
                  padding: '5px 0 5px 0', 
                  fontSize: '12px', 
                  width: '100px', 
                  background: 'transparent', 
                  border: 'none', 
                  borderBottom: '2px dotted #0f1420cc', 
                  borderRadius: '0' 
                }}
                placeholder="End value"
              />
            </>
          )}
        </>
      ) : (
        // Display mode - show summary
        <span style={{ fontSize: '12px', color: '#e6edf3', userSelect: 'none' }}>
          {filter.field} {getOperatorSymbol(filter.operator)}
          {!['empty', 'not_empty'].includes(filter.operator) && filter.value ? ` ${filter.value}` : ''}
          {filter.operator === 'between' && filter.value2 ? ` and ${filter.value2}` : ''}
          {!['empty', 'not_empty'].includes(filter.operator) && !filter.value ? ' (no value)' : ''}
        </span>
      )}
    </div>
  );
}

function DateFilterRow({ filter, fields, onUpdate, onRemove }: {
  filter: DateFilter;
  fields: Field[];
  onUpdate: (updates: Partial<DateFilter>) => void;
  onRemove: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const formatDateForInput = (date?: Date) => {
    if (!date) return '';
    return date.toISOString().split('T')[0];
  };

  const formatDateDisplay = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleDateString();
  };

  // Close editing when clicking outside
  const handleBlur = (e: React.FocusEvent) => {
    // Check if the new focus target is still within this component
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsEditing(false);
    }
  };

  const baseBackgroundColor = '#23293a';
  const hoverBackgroundColor = '#2a3142';

  return (
    <div 
      style={{ 
        display: 'flex', 
        gap: 8, 
        alignItems: 'center', 
        marginBottom: 8, 
        padding: '8px', 
        background: isHovered ? hoverBackgroundColor : baseBackgroundColor,
        borderRadius: '6px', 
        flexWrap: 'wrap',
        position: 'relative',
        cursor: isEditing ? 'default' : 'pointer',
        transition: 'background-color 0.2s ease',
        minHeight: '40px',
      }}
      onClick={() => !isEditing && setIsEditing(true)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onBlur={handleBlur}
      tabIndex={0}
              title={isEditing ? undefined : "Click to edit"}

    >
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{ 
          color: '#ef4444', 
          background: 'none', 
          border: 'none', 
          cursor: 'pointer',
          fontSize: '16px',
          position: 'absolute', 
          top: 5,
          right: 5
        }}
      >
        ×
      </button>

      {isEditing ? (
        // Edit mode - show inputs
        <>
          <select 
            value={filter.field}
            onChange={(e) => onUpdate({ field: e.target.value })}
            className="chart-select"
            style={{ 
              padding: '5px 0 5px 0', 
              fontSize: '12px', 
              width: '100px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: '2px dotted #0f1420cc', 
              borderRadius: '0' 
            }}
            autoFocus
          >
            {fields.map(f => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>

          <select
            value={filter.operator}
            onChange={(e) => onUpdate({ operator: e.target.value as any })}
            className="chart-select"
            style={{ 
              padding: '5px 0 5px 0', 
              fontSize: '12px', 
              width: '100px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: '2px dotted #0f1420cc', 
              borderRadius: '0' 
            }}
          >
            <option value="eq">=</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="between">between</option>
          </select>

          <input
            type="date"
            value={formatDateForInput(filter.value)}
            onChange={(e) => onUpdate({ value: new Date(e.target.value) })}
            className="input"
            style={{ 
              padding: '5px 0 5px 0', 
              fontSize: '12px', 
              width: '120px', 
              background: 'transparent', 
              border: 'none', 
              borderBottom: '2px dotted #0f1420cc', 
              borderRadius: '0' 
            }}
          />

          {filter.operator === 'between' && (
            <>
              <span>and</span>
              <input
                type="date"
                value={formatDateForInput(filter.value2)}
                onChange={(e) => onUpdate({ value2: new Date(e.target.value) })}
                className="input"
                style={{ 
                  padding: '5px 0 5px 0', 
                  fontSize: '12px', 
                  width: '120px', 
                  background: 'transparent', 
                  border: 'none', 
                  borderBottom: '2px dotted #0f1420cc', 
                  borderRadius: '0' 
                }}
              />
            </>
          )}
        </>
      ) : (
        // Display mode - show summary
        <span style={{ fontSize: '12px', color: '#e6edf3', userSelect: 'none' }}>
          {filter.field} {filter.operator} 
          {filter.value ? ' ' + formatDateDisplay(filter.value) : ' (no date)'} 
          {filter.operator === 'between' ? ` and ${filter.value2 ? formatDateDisplay(filter.value2) : '(no end date)'}` : ''}
        </span>
      )}
    </div>
  );
}