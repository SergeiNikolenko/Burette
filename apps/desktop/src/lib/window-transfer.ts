import { nativePageTransferBusy } from "../components/workspace-panes/native-page-window";
import { nativePopoutBusy } from "../components/workspace-panes/native-scene-window";

export function nativeWindowTransferBusy() {
  return nativePopoutBusy() || nativePageTransferBusy();
}
