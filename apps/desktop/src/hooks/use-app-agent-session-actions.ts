import { useMemo } from "react";

type UseAppAgentSessionActionsOptions = {
  closeTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  openNewTab: () => void;
  setActiveTab: (id: string) => void;
};

export function useAppAgentSessionActions({
  closeTab,
  moveTab,
  openNewTab,
  setActiveTab,
}: UseAppAgentSessionActionsOptions) {
  return useMemo(() => ({
    openNewTab,
    setActiveTab,
    closeTab,
    moveTab,
  }), [openNewTab, setActiveTab, closeTab, moveTab]);
}
