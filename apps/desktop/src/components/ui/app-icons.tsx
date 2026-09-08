import { forwardRef, type ComponentProps } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import * as glyphs from "./app-icon-data";

// Use the existing SVG renderer for both icon families. The reviewed SDK paths
// preserve stroke:none through a node utility because Hugeicons overrides SVG
// attributes with caller stroke widths. Controls still own size and animation.
type AppIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon" | "altIcon" | "showAlt">;
function appIcon(name: keyof typeof glyphs) {
  const Icon = forwardRef<SVGSVGElement, AppIconProps>((props, ref) => (
    <HugeiconsIcon {...props} ref={ref} icon={glyphs[name]} />
  ));
  Icon.displayName = name;
  return Icon;
}

export type AppIconType = ReturnType<typeof appIcon>;
// BEGIN GENERATED EXPORTS
export const Agent = /* @__PURE__ */ appIcon("Agent");
export const ArrowCurvedRight = /* @__PURE__ */ appIcon("ArrowCurvedRight");
export const ArrowLeft = /* @__PURE__ */ appIcon("ArrowLeft");
export const ArrowRight = /* @__PURE__ */ appIcon("ArrowRight");
export const ArrowRotateCcw = /* @__PURE__ */ appIcon("ArrowRotateCcw");
export const ArrowRotateCw = /* @__PURE__ */ appIcon("ArrowRotateCw");
export const ArrowUp = /* @__PURE__ */ appIcon("ArrowUp");
export const Atom = /* @__PURE__ */ appIcon("Atom");
export const BarChart = /* @__PURE__ */ appIcon("BarChart");
export const Camera = /* @__PURE__ */ appIcon("Camera");
export const CameraPhoto = /* @__PURE__ */ appIcon("CameraPhoto");
export const Chart = /* @__PURE__ */ appIcon("Chart");
export const Check = /* @__PURE__ */ appIcon("Check");
export const CheckCircle = /* @__PURE__ */ appIcon("CheckCircle");
export const ChevronDown = /* @__PURE__ */ appIcon("ChevronDown");
export const ChevronRight = /* @__PURE__ */ appIcon("ChevronRight");
export const ChevronUp = /* @__PURE__ */ appIcon("ChevronUp");
export const ChevronUpDown = /* @__PURE__ */ appIcon("ChevronUpDown");
export const Circle = /* @__PURE__ */ appIcon("Circle");
export const Clip = /* @__PURE__ */ appIcon("Clip");
export const Clipboard = /* @__PURE__ */ appIcon("Clipboard");
export const Collapse = /* @__PURE__ */ appIcon("Collapse");
export const ColorTheme = /* @__PURE__ */ appIcon("ColorTheme");
export const Compare = /* @__PURE__ */ appIcon("Compare");
export const CompareArrows = /* @__PURE__ */ appIcon("CompareArrows");
export const Copy = /* @__PURE__ */ appIcon("Copy");
export const Cube = /* @__PURE__ */ appIcon("Cube");
export const Delete = /* @__PURE__ */ appIcon("Delete");
export const DotsHorizontal = /* @__PURE__ */ appIcon("DotsHorizontal");
export const Download = /* @__PURE__ */ appIcon("Download");
export const Email = /* @__PURE__ */ appIcon("Email");
export const Expand = /* @__PURE__ */ appIcon("Expand");
export const ExternalLink = /* @__PURE__ */ appIcon("ExternalLink");
export const Eye = /* @__PURE__ */ appIcon("Eye");
export const EyeOff = /* @__PURE__ */ appIcon("EyeOff");
export const FileBlank = /* @__PURE__ */ appIcon("FileBlank");
export const FileCode = /* @__PURE__ */ appIcon("FileCode");
export const FileDocument = /* @__PURE__ */ appIcon("FileDocument");
export const FileImage = /* @__PURE__ */ appIcon("FileImage");
export const FileSpreadsheet = /* @__PURE__ */ appIcon("FileSpreadsheet");
export const FileUpload = /* @__PURE__ */ appIcon("FileUpload");
export const Filter = /* @__PURE__ */ appIcon("Filter");
export const Flask = /* @__PURE__ */ appIcon("Flask");
export const Folder = /* @__PURE__ */ appIcon("Folder");
export const FolderOpen = /* @__PURE__ */ appIcon("FolderOpen");
export const FolderPlus = /* @__PURE__ */ appIcon("FolderPlus");
export const History = /* @__PURE__ */ appIcon("History");
export const InfoCircle = /* @__PURE__ */ appIcon("InfoCircle");
export const Keyboard = /* @__PURE__ */ appIcon("Keyboard");
export const Lightbulb = /* @__PURE__ */ appIcon("Lightbulb");
export const Link = /* @__PURE__ */ appIcon("Link");
export const Minus = /* @__PURE__ */ appIcon("Minus");
export const Pin = /* @__PURE__ */ appIcon("Pin");
export const Play = /* @__PURE__ */ appIcon("Play");
export const PlayCircle = /* @__PURE__ */ appIcon("PlayCircle");
export const Plus = /* @__PURE__ */ appIcon("Plus");
export const Reload = /* @__PURE__ */ appIcon("Reload");
export const Scissor = /* @__PURE__ */ appIcon("Scissor");
export const Search = /* @__PURE__ */ appIcon("Search");
export const SettingsCog = /* @__PURE__ */ appIcon("SettingsCog");
export const SettingsSlider = /* @__PURE__ */ appIcon("SettingsSlider");
export const SettingsWrench = /* @__PURE__ */ appIcon("SettingsWrench");
export const SidebarLeft = /* @__PURE__ */ appIcon("SidebarLeft");
export const SidebarRight = /* @__PURE__ */ appIcon("SidebarRight");
export const Stack = /* @__PURE__ */ appIcon("Stack");
export const Stop = /* @__PURE__ */ appIcon("Stop");
export const Stopwatch = /* @__PURE__ */ appIcon("Stopwatch");
export const Tag = /* @__PURE__ */ appIcon("Tag");
export const Undo = /* @__PURE__ */ appIcon("Undo");
export const Unpin = /* @__PURE__ */ appIcon("Unpin");
export const Warning = /* @__PURE__ */ appIcon("Warning");
export const X = /* @__PURE__ */ appIcon("X");
export const XCircleCrossedClose = /* @__PURE__ */ appIcon("XCircleCrossedClose");
export const PinFilled = /* @__PURE__ */ appIcon("PinFilled");
