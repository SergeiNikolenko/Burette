import * as React from "react";

export function useAppShellPortalContainer() {
  const [container, setContainer] = React.useState<HTMLElement>();

  React.useLayoutEffect(() => {
    setContainer(document.querySelector<HTMLElement>(".app-shell") ?? document.body);
  }, []);

  return container;
}
