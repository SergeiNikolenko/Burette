import {
  Activity,
  AppWindow,
  Atom,
  Bot,
  ChartLine,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Cpu,
  Ellipsis,
  File,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Info,
  Keyboard,
  List,
  ListChecks,
  Maximize2,
  Minimize2,
  MonitorCog,
  Palette,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  SquareSplitHorizontal,
  Sun,
  Terminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";

export type SystemIconName =
  | "app"
  | "arrow.down.right.and.arrow.up.left"
  | "arrow.triangle.2.circlepath"
  | "arrow.up.left.and.arrow.down.right"
  | "atom"
  | "chart.xyaxis.line"
  | "checklist"
  | "chevron.down"
  | "chevron.forward"
  | "chevron.left"
  | "cpu"
  | "doc"
  | "doc.plaintext"
  | "doc.text"
  | "ellipsis"
  | "folder"
  | "folder.fill"
  | "gearshape"
  | "gearshape.2"
  | "info.circle"
  | "keyboard"
  | "list.bullet.rectangle"
  | "magnifyingglass"
  | "paintpalette"
  | "pin"
  | "pin.fill"
  | "plus"
  | "rectangle.bottomthird.inset.filled"
  | "sidebar.left"
  | "sidebar.right"
  | "sparkles"
  | "stethoscope"
  | "square.and.pencil"
  | "square.split.2x1"
  | "sun.max"
  | "terminal"
  | "tray.full"
  | "wrench.and.screwdriver"
  | "xmark";

const iconBySymbolName: Record<SystemIconName, LucideIcon> = {
  app: AppWindow,
  "arrow.down.right.and.arrow.up.left": Minimize2,
  "arrow.triangle.2.circlepath": RefreshCw,
  "arrow.up.left.and.arrow.down.right": Maximize2,
  atom: Atom,
  "chart.xyaxis.line": ChartLine,
  checklist: ListChecks,
  "chevron.down": ChevronDown,
  "chevron.forward": ChevronRight,
  "chevron.left": ChevronLeft,
  cpu: Cpu,
  doc: File,
  "doc.plaintext": FileText,
  "doc.text": FileText,
  ellipsis: Ellipsis,
  folder: Folder,
  "folder.fill": FolderOpen,
  gearshape: Settings,
  "gearshape.2": MonitorCog,
  "info.circle": Info,
  keyboard: Keyboard,
  "list.bullet.rectangle": List,
  magnifyingglass: Search,
  paintpalette: Palette,
  pin: Pin,
  "pin.fill": Pin,
  plus: Plus,
  "rectangle.bottomthird.inset.filled": PanelBottom,
  "sidebar.left": PanelLeft,
  "sidebar.right": PanelRight,
  sparkles: Sparkles,
  stethoscope: Activity,
  "square.and.pencil": SquarePen,
  "square.split.2x1": SquareSplitHorizontal,
  "sun.max": Sun,
  terminal: Terminal,
  "tray.full": Inbox,
  "wrench.and.screwdriver": Wrench,
  xmark: X,
};

export function SystemIcon({
  name,
  size = 16,
  className,
  strokeWidth = 2,
}: {
  name: SystemIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = iconBySymbolName[name];
  return (
    <Icon
      className={className}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      strokeWidth={strokeWidth}
    />
  );
}
