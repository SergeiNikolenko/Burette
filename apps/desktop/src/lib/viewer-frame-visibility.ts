// Shell visibility is explicit: measuring boxes would force layout and cannot
// distinguish a warm, visibility:hidden page from the current scene.
export function isViewerFrameVisible(frame: HTMLIFrameElement) {
  if (frame.closest('[hidden], [aria-hidden="true"], [data-source-preview-role="staging"]')) return false;
  const page = frame.closest(".page-surface");
  return !page || page.matches('[data-active]:not([data-active="false"]), [data-pane-shown="visible"]');
}
