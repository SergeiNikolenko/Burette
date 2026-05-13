import { useEffect } from "react";

export function useWindowTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
