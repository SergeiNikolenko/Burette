import { invoke } from "@tauri-apps/api/core";
import { toast } from "../components/ui/toast";
import type { GlobalRecentStructuresSnapshot } from "./global-recent-structures";

export async function clearNativeRecentStructures(apply: (snapshot: GlobalRecentStructuresSnapshot) => void) {
  try {
    apply(await invoke<GlobalRecentStructuresSnapshot>("clear_recent_documents"));
  } catch {
    const notice = toast.add({
      title: "Recent structures could not be cleared",
      type: "error",
      timeout: 0,
      priority: "high",
      actionProps: {
        children: "Retry",
        onClick: () => {
          toast.close(notice);
          void clearNativeRecentStructures(apply);
        },
      },
    });
  }
}
