import { useShellStore } from "../stores/shell-store";

export function useDockLayout() {
  const rightDockOpen = useShellStore((state) => state.rightDockOpen);
  const rightDockWidth = useShellStore((state) => state.rightDockWidth);
  const rightDockTabs = useShellStore((state) => state.rightDockTabs);
  const rightDockActiveTab = useShellStore((state) => state.rightDockActiveTab);
  const rightDockDocumentId = useShellStore((state) => state.rightDockDocumentId);
  const rightDockTool = useShellStore((state) => state.rightDockTool);
  const bottomDockOpen = useShellStore((state) => state.bottomDockOpen);
  const bottomDockHeight = useShellStore((state) => state.bottomDockHeight);
  const bottomDockTabs = useShellStore((state) => state.bottomDockTabs);
  const bottomDockActiveTab = useShellStore((state) => state.bottomDockActiveTab);
  const bottomDockDocumentId = useShellStore((state) => state.bottomDockDocumentId);
  const bottomDockTool = useShellStore((state) => state.bottomDockTool);
  const dockDroppedStructures = useShellStore((state) => state.dockDroppedStructures);
  const toggleDock = useShellStore((state) => state.toggleDock);
  const setDockOpen = useShellStore((state) => state.setDockOpen);
  const setDockSize = useShellStore((state) => state.setDockSize);
  const openDockTab = useShellStore((state) => state.openDockTab);
  const closeDockTab = useShellStore((state) => state.closeDockTab);
  const setDockActiveTab = useShellStore((state) => state.setDockActiveTab);
  const setDockDocument = useShellStore((state) => state.setDockDocument);
  const setDockTool = useShellStore((state) => state.setDockTool);
  const addDockDrop = useShellStore((state) => state.addDockDrop);

  return {
    rightDockOpen,
    rightDockWidth,
    rightDockTabs,
    rightDockActiveTab,
    rightDockDocumentId,
    rightDockTool,
    bottomDockOpen,
    bottomDockHeight,
    bottomDockTabs,
    bottomDockActiveTab,
    bottomDockDocumentId,
    bottomDockTool,
    dockDroppedStructures,
    toggleDock,
    setDockOpen,
    setDockSize,
    openDockTab,
    closeDockTab,
    setDockActiveTab,
    setDockDocument,
    setDockTool,
    addDockDrop,
  };
}
