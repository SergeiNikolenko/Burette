import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useThemePortalContainer } from "../radix-menu";

export type SettingRow = {
  label: string;
  description?: string;
  control: ReactNode;
  reset?: () => void;
  isModified?: boolean;
  confirm?: boolean;
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
          row.confirm ? (
            <ConfirmActionButton
              className="settings-reset-button"
              disabled={!row.isModified}
              hidden={!row.isModified}
              title="Reset to default"
              label="Reset"
              dialogTitle={`Reset ${row.label}?`}
              dialogDescription="This will restore the default value for this setting."
              confirmLabel="Reset"
              onConfirm={row.reset}
            />
          ) : (
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
          )
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

const HEX_COLOR = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function ColorControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const swatch = HEX_COLOR.test(value) ? value : "#000000";
  return (
    <div className="settings-color-control">
      <span className="settings-color-swatch" style={{ backgroundColor: swatch }}>
        <input
          type="color"
          value={swatch}
          aria-label="Pick color"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </span>
      <input
        type="text"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => {
          if (!HEX_COLOR.test(event.target.value)) onChange(swatch.toUpperCase());
        }}
      />
    </div>
  );
}

export function TextControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      className="settings-text-control"
      value={value}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
    />
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
      <span>{Math.round(value)}</span>
    </div>
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

export function colorPreferenceRow(
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
    isModified: value.toUpperCase() !== defaultValue.toUpperCase(),
  };
}

export function textPreferenceRow(
  label: string,
  description: string,
  value: string,
  defaultValue: string,
  onChange: (value: string) => void,
): SettingRow {
  return {
    label,
    description,
    control: <TextControl value={value} onChange={onChange} />,
    reset: () => onChange(defaultValue),
    isModified: value !== defaultValue,
  };
}

export function rangePreferenceRow(
  label: string,
  description: string,
  value: number,
  defaultValue: number,
  onChange: (value: number) => void,
): SettingRow {
  return {
    label,
    description,
    control: <RangeControl value={value} min={0} max={100} step={1} onChange={onChange} />,
    reset: () => onChange(defaultValue),
    isModified: value !== defaultValue,
  };
}

export function actionRow(label: string, description: string, buttonLabel: string, onClick: () => void, disabled?: boolean, confirm?: boolean): SettingRow {
  return {
    label,
    description,
    control: (
      <SettingsActionButton onClick={onClick} disabled={disabled} confirm={confirm} label={buttonLabel} dialogTitle={`${buttonLabel} ${label}?`}>
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
  confirm,
  label,
  dialogTitle,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
  confirm?: boolean;
  label?: string;
  dialogTitle?: string;
}) {
  if (confirm) {
    return (
      <ConfirmActionButton
        className="settings-action-button"
        disabled={disabled}
        label={label ?? children}
        dialogTitle={dialogTitle ?? "Confirm action"}
        dialogDescription="This action changes the current workspace state."
        confirmLabel={label ?? "Confirm"}
        onConfirm={onClick}
      />
    );
  }

  return (
    <button type="button" className="settings-action-button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function ConfirmActionButton({
  className,
  disabled,
  hidden,
  title,
  label,
  dialogTitle,
  dialogDescription,
  confirmLabel,
  onConfirm,
}: {
  className: string;
  disabled?: boolean;
  hidden?: boolean;
  title?: string;
  label: ReactNode;
  dialogTitle: string;
  dialogDescription: string;
  confirmLabel: ReactNode;
  onConfirm: () => void;
}) {
  const portalContainer = useThemePortalContainer();

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={className}
          disabled={disabled}
          aria-hidden={hidden}
          tabIndex={hidden ? -1 : 0}
          title={title}
          data-hidden={hidden || undefined}
        >
          {label}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal container={portalContainer}>
        <Dialog.Overlay className="radix-dialog-overlay" />
        <Dialog.Content className="radix-dialog" aria-describedby="settings-confirm-description">
          <div className="radix-dialog-header">
            <Dialog.Title>{dialogTitle}</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="radix-dialog-close" aria-label="Cancel">
                ×
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description id="settings-confirm-description" className="radix-dialog-description">
            {dialogDescription}
          </Dialog.Description>
          <div className="radix-dialog-actions">
            <Dialog.Close asChild>
              <button type="button" className="settings-action-button">Cancel</button>
            </Dialog.Close>
            <Dialog.Close asChild>
              <button type="button" className="settings-action-button" onClick={onConfirm}>
                {confirmLabel}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
