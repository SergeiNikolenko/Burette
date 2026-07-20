import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime, trackTauriListener } from "../lib/tauri";
import { type NativeMenuCommand, MENU_COMMAND_EVENT } from "../lib/native-menu";

type UseMenuEventsOptions = {
  handleNativeMenuCommand: (payload: NativeMenuCommand) => void | Promise<void>;
};

export function useMenuEvents(options: UseMenuEventsOptions) {
  const handlersRef = useRef(options);

  useEffect(() => {
    handlersRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let drainChain = Promise.resolve();
    const drainNativeMenuCommands = () => {
      drainChain = drainChain
        .then(async () => {
          const commands = await invoke<NativeMenuCommand[]>("drain_native_menu_commands");
          for (const command of commands) {
            try {
              await handlersRef.current.handleNativeMenuCommand(command);
            } catch (error) {
              console.error("Native menu command failed", error);
            }
          }
        })
        .catch((error) => {
          console.warn("Native menu command drain failed", error);
        });
    };
    const cleanups = [
      trackTauriListener(
        listen<void>(MENU_COMMAND_EVENT, drainNativeMenuCommands),
        MENU_COMMAND_EVENT,
        drainNativeMenuCommands,
      ),
    ];

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);
}
