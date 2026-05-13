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

export function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="settings-toggle"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      data-checked={checked || undefined}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
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

export function actionRow(label: string, description: string, buttonLabel: string, onClick: () => void, disabled?: boolean): SettingRow {
  return {
    label,
    description,
    control: (
      <SettingsActionButton onClick={onClick} disabled={disabled}>
        {buttonLabel}
      </SettingsActionButton>
    ),
  };
}

export function SettingSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <SettingControl
      row={{
        label,
        control: <SelectControl value={value} options={options} onChange={onChange} />,
      }}
    />
  );
}

export function SettingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <SettingControl row={{ label, control: <ToggleControl label={label} checked={checked} onChange={onChange} /> }} />
  );
}

export function SettingsActionButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-action-button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
