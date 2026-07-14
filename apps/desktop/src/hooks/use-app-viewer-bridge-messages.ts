import { useEffect } from "react";

import {
  dispatchViewerBridgeMessage,
  parseViewerBridgeMessage,
  type ViewerBridgeMessageHandlers,
} from "../lib/viewer-bridge-messages";

type UseAppViewerBridgeMessagesOptions = ViewerBridgeMessageHandlers;

export function useAppViewerBridgeMessages({
  handleDockingPoseMessage,
  handleGridConformerMessage,
  handleGridControlMessage,
  handleGridFileMessage,
  handleGridRuntimeMessage,
  handleKetcherViewerMessage,
  handleMolstarContextMessage,
  handlePubChemSearchMessage,
  handleRendererMessage,
  handleSdfViewerMessage,
  handleViewerConformerMessage,
  handleViewerFileMessage,
  handleViewerHostMessage,
  handleViewerRuntimeFileMessage,
  handleViewerRuntimeMessage,
  handleViewerStateMessage,
  handleXyzrenderSheetMessage,
  isKnownViewerMessageSource,
  markViewerFirstRenderMessage,
}: UseAppViewerBridgeMessagesOptions) {
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const message = parseViewerBridgeMessage(event);
      if (!message) return;
      await dispatchViewerBridgeMessage(message, {
        handleDockingPoseMessage,
        handleGridConformerMessage,
        handleGridControlMessage,
        handleGridFileMessage,
        handleGridRuntimeMessage,
        handleKetcherViewerMessage,
        handleMolstarContextMessage,
        handlePubChemSearchMessage,
        handleRendererMessage,
        handleSdfViewerMessage,
        handleViewerConformerMessage,
        handleViewerFileMessage,
        handleViewerHostMessage,
        handleViewerRuntimeFileMessage,
        handleViewerRuntimeMessage,
        handleViewerStateMessage,
        handleXyzrenderSheetMessage,
        isKnownViewerMessageSource,
        markViewerFirstRenderMessage,
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    handleDockingPoseMessage,
    handleGridConformerMessage,
    handleGridControlMessage,
    handleGridFileMessage,
    handleGridRuntimeMessage,
    handleKetcherViewerMessage,
    handleMolstarContextMessage,
    handlePubChemSearchMessage,
    handleRendererMessage,
    handleSdfViewerMessage,
    handleViewerConformerMessage,
    handleViewerFileMessage,
    handleViewerHostMessage,
    handleViewerRuntimeFileMessage,
    handleViewerRuntimeMessage,
    handleViewerStateMessage,
    handleXyzrenderSheetMessage,
    isKnownViewerMessageSource,
    markViewerFirstRenderMessage,
  ]);
}
