import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";

type Target =
  | { kind: "pdb"; id: string }
  | { kind: "file" | "project"; path: string }
  | { kind: "session"; sessionDir: string; paths: string[] }
  | { kind: "error"; message: string };

type Actions = {
  openPaths: (paths: string[]) => void | Promise<void>;
  fetchPdbStructure: (id: string) => Promise<void>;
  activateSession: (directory: string, prepare: () => void | Promise<void>) => Promise<void>;
  pushErrorStatus: (error: unknown, prefix?: string) => void;
};

export function useDeepLinks(actions: Actions) {
  const current = useRef(actions);
  current.current = actions;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    // Subscribe before draining so cold launch and a recreated workspace cannot lose URLs.
    let sequence = Promise.resolve();
    const drain = () => {
      sequence = sequence.then(async () => {
        const targets = await invoke<Target[]>("drain_deep_links");
        for (const target of targets) {
          try {
            switch (target.kind) {
              case "pdb": await current.current.fetchPdbStructure(target.id); break;
              case "file":
              case "project": await current.current.openPaths([target.path]); break;
              case "session":
                await current.current.activateSession(target.sessionDir, () => current.current.openPaths(target.paths));
                break;
              case "error": throw new Error(target.message);
            }
          } catch (error) { current.current.pushErrorStatus(error, "Cannot open Burette link"); }
        }
      }).catch((error) => current.current.pushErrorStatus(error, "Cannot open Burette link"));
    };
    return trackTauriListener(listen("deep-links", drain).then((unlisten) => {
      drain();
      return unlisten;
    }), "deep-links");
  }, []);
}
