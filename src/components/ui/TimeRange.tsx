interface TimeRangeProps<T extends number | string> {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}

/**
 * TimeRange — segmented pill control for switching date windows.
 * Lives in a Panel's `actions` slot on charts.
 */
export default function TimeRange<T extends number | string>({
  options,
  value,
  onChange,
  format,
}: TimeRangeProps<T>) {
  const render = format ?? ((v: T) => (typeof v === 'number' ? `${v}D` : String(v)));
  return (
    <div className="time-range">
      {options.map((opt) => (
        <button
          key={String(opt)}
          className={value === opt ? 'active' : ''}
          onClick={() => onChange(opt)}
          type="button"
        >
          {render(opt)}
        </button>
      ))}
    </div>
  );
}
