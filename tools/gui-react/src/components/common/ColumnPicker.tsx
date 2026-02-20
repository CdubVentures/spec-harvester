import { selectCls, AZ_COLUMNS } from '../../pages/studio/studioConstants';

interface ColumnPickerProps {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export function ColumnPicker({ value, onChange, className = 'w-full' }: ColumnPickerProps) {
  return (
    <select
      className={`${selectCls} ${className}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">(auto)</option>
      {AZ_COLUMNS.map((col) => (
        <option key={col} value={col}>{col}</option>
      ))}
    </select>
  );
}
