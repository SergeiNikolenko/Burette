import { AppLayout } from "./components/app-layout";
import { WindowTitle } from "./components/window-title";
import { useAppShell } from "./hooks/use-app-shell";
import "./App.css";

export default function App() {
  const shell = useAppShell();

  return (
    <>
      <WindowTitle
        activeDocument={shell.state.activeDocument}
        page={shell.state.page}
      />
      <AppLayout
        state={shell.state}
        actions={shell.actions}
        onToggleSidebar={shell.toggleSidebar}
        onResizeStart={shell.startSidebarResize}
        onDragEnter={shell.handleBrowserDrag}
        onDragOver={shell.handleBrowserDrag}
        onDragLeave={shell.handleBrowserDragLeave}
        onDrop={shell.handleBrowserDrop}
      />
    </>
  );
}
