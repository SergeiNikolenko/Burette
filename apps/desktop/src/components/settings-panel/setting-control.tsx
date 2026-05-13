import type { ReactNode } from "react";

export type SettingRow = {
  label: string;
  description?: string;
  control: ReactNode;
  reset?: () => void;
  isModified?: boolean;
};

export function SettingsSection({ title, rows }: { title: string; rows: SettingRow[] }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      <div className="settings-card">
        {rows.map((row) => (
          <SettingControl key={row.label} row={row} />
        ))}
      </div>
    </section>
  );
}

export function SettingControl({ row }: { row: SettingRow }) {
  return (
    <div className="settings-control">
      <div className="settings-control-copy">
        <div className="settings-control-label">{row.label}</div>
        {row.description && <div className="settings-control-description">{row.description}</div>}
      </div>
      <div className="settings-control-actions">
        {row.reset && (
          <button
            type="button"
            className="settings-reset-button"
            onClick={row.reset}
            aria-hidden={!row.isModified}
            tabIndex={row.isModified ? 0 : -1}
            title="Reset to default"
            data-hidden={!row.isModified || undefined}
          >
            Reset
          </button>
        )}
        {row.control}
      </div>
    </div>
  );
}

export function ToggleControl({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="settings-toggle"
      data-checked={checked || undefined}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function ColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="settings-color-control">
      <span className="settings-color-swatch" style={{ backgroundColor: value }}>
        <input
          type="color"
          value={value}
          aria-label="Pick color"
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      <input
        className="settings-color-input"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

export function RangeControl({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-range-control">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>{value.toFixed(step < 0.01 ? 3 : 2)}</span>
    </div>
  );
}

export function SelectControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select className="settings-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

export function colorRow(
  label: string,
  description: string,
  value: string,
  defaultValue: string,
  onChange: (value: string) => void,
): SettingRow {
  return {
    label,
    description,
    control: <ColorControl value={value} onChange={onChange} />,
    reset: () => onChange(defaultValue),
    isModified: value.toLowerCase() !== defaultValue.toLowerCase(),
  };
}

export function rangeRow(
  label: string,
  description: string,
  value: number,
  defaultValue: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
): SettingRow {
  return {
    label,
    description,
    control: <RangeControl value={value} min={min} max={max} step={step} onChange={onChange} />,
    reset: () => onChange(defaultValue),
    isModified: value !== defaultValue,
  };
}

export function selectPreferenceRow(
  label: string,
  description: string,
  value: string,
  options: string[],
  defaultValue: string,
  onChange: (value: string) => void,
): SettingRow {
  return {
    label,
    description,
    control: <SelectControl value={value} options={options} onChange={onChange} />,
    reset: () => onChange(defaultValue),
    isModified: value !== defaultValue,
  };
}

export function actionRow(label: string, description: string, onClick: () => void): SettingRow {
  return {
    label,
    description,
    control: (
      <button type="button" className="settings-action-button" onClick={onClick}>
        Run
      </button>
    ),
  };
}
