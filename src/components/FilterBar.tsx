'use client';

interface FilterBarProps {
  filters: Record<string, string>;
  onChange: (key: string, value: string) => void;
  fields: Array<{
    key: string;
    label: string;
    type: 'text' | 'select' | 'date';
    options?: string[];
    placeholder?: string;
  }>;
}

export default function FilterBar({ filters, onChange, fields }: FilterBarProps) {
  const inputClass =
    'h-8 rounded px-2 text-xs focus:outline-none transition-colors';
  const inputStyle: React.CSSProperties = {
    background: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--border-bright)',
  };

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1">
          <label
            className="text-[10px] uppercase tracking-[0.1em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {field.label}
          </label>
          {field.type === 'select' ? (
            <select
              value={filters[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">All</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : field.type === 'date' ? (
            <input
              type="date"
              value={filters[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              className={inputClass}
              style={inputStyle}
            />
          ) : (
            <input
              type="text"
              value={filters[field.key] ?? ''}
              onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder ?? ''}
              className={`${inputClass} w-44 placeholder:text-[var(--text-muted)]`}
              style={inputStyle}
            />
          )}
        </div>
      ))}
    </div>
  );
}
