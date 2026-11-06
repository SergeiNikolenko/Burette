import { toast } from "../components/ui/toast";
import { isMacPlatform } from "./platform";

export function showMacAvailability(description = isMacPlatform()
  ? "Opening local apps and Finder is not available in this browser preview."
  : "Opening local apps and the file manager is not available in this browser preview.") {
  toast.add({
    title: isMacPlatform() ? "Available in Burette for Mac" : "Available in the Burette desktop app",
    description,
    type: "info",
    timeout: 7000,
  });
}
