import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

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
      <Card className="settings-card">
        {rows.map((row) => (
          <SettingControl key={row.label} row={row} />
        ))}
      </Card>
    </section>
  );
}

export function SettingControl({ row }: { row: SettingRow }) {
  return (
    <Field orientation="responsive" className="settings-control">
      <FieldContent className="settings-control-copy">
        <FieldTitle className="settings-control-label">{row.label}</FieldTitle>
        {row.description && <FieldDescription className="settings-control-description">{row.description}</FieldDescription>}
      </FieldContent>
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
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="settings-reset-button"
              onClick={row.reset}
              disabled={!row.isModified}
              aria-hidden={!row.isModified}
              tabIndex={row.isModified ? 0 : -1}
              title="Reset to default"
              data-hidden={!row.isModified || undefined}
            >
              Reset
            </Button>
          )
        )}
        {row.control}
      </div>
    </Field>
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
    <NativeSelect className="settings-select" size="sm" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <NativeSelectOption key={option} value={option}>
          {option}
        </NativeSelectOption>
      ))}
    </NativeSelect>
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
        <Input
          type="color"
          value={swatch}
          aria-label="Pick color"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </span>
      <Input
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
    <Input
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
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const displayValue = Number.isInteger(step) ? Math.round(value).toString() : value.toFixed(2).replace(/\.?0+$/u, "");
  return (
    <div className="settings-range-control">
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(values) => {
          const nextValue = values[0];
          if (nextValue !== undefined) onChange(nextValue);
        }}
      />
      <span>{suffix ? `${displayValue} ${suffix}` : displayValue}</span>
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
    <Switch
      className="settings-toggle"
      aria-label={label}
      checked={checked}
      onCheckedChange={onChange}
    />
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
    <Button type="button" variant="secondary" size="sm" className="settings-action-button" disabled={disabled} onClick={onClick}>
      {children}
    </Button>
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
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={className === "settings-reset-button" ? "ghost" : "secondary"}
          size={className === "settings-reset-button" ? "xs" : "sm"}
          className={className}
          disabled={disabled}
          aria-hidden={hidden}
          tabIndex={hidden ? -1 : 0}
          title={title}
          data-hidden={hidden || undefined}
        >
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription id="settings-confirm-description">
            {dialogDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
