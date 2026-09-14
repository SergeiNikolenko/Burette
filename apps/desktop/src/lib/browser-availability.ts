import { toast } from "../components/ui/toast";

export function showMacAvailability(description = "Opening local apps and Finder is not available in this browser preview.") {
  toast.add({
    title: "Available in Burette for Mac",
    description,
    type: "info",
    timeout: 7000,
  });
}
