/**
 * The browser file chooser behind a hidden input that stays attached to the page
 * while the chooser is open. A detached input is not part of the document the
 * browser and its automation resolve the chosen files against, so the pick could
 * be lost. The input is removed on change, cancel or a failed click; a new pick
 * also retires an earlier one still waiting, for browsers that never send cancel.
 */
let pending: { input: HTMLInputElement; settle: (files: File[]) => void } | null = null;

export function pickBrowserFiles(options: { accept?: string; multiple?: boolean; directory?: boolean } = {}) {
  pending?.settle([]);
  return new Promise<File[]>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.hidden = true;
    input.multiple = options.multiple === true;
    if (options.accept) input.accept = options.accept;
    if (options.directory) input.setAttribute("webkitdirectory", "");
    const entry = {
      input,
      settle: (files: File[]) => {
        if (pending === entry) pending = null;
        input.remove();
        resolve(files);
      },
    };
    input.addEventListener("change", () => entry.settle(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => entry.settle([]), { once: true });
    pending = entry;
    document.body.append(input);
    try {
      input.click();
    } catch (error) {
      if (pending === entry) pending = null;
      input.remove();
      reject(error);
    }
  });
}
