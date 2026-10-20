import { useId, type CSSProperties, type ReactNode } from 'react';

interface Props {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function VolumeSlider({ label, value, onChange, disabled }: Props) {
  const id = useId();
  return (
    <div className="volume">
      <div className="control-head">
        <label htmlFor={id} className="control-label">
          {label}
        </label>
        <output htmlFor={id} className="control-value">
          {value}%
        </output>
      </div>
      <input
        id={id}
        className="range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--val': `${value}%` } as CSSProperties}
      />
    </div>
  );
}
