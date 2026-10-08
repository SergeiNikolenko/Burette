import type React from "react";

import { Spinner as AppSpinner } from "@/components/ui/spinner";

export function Spinner(props: React.ComponentProps<typeof AppSpinner>): React.ReactElement {
  return <AppSpinner {...props} />;
}
