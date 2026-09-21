// Serialized into the same-origin preview iframe. Keep this function self-contained.
export function installWorkspaceTooltipLayout() {
  const host = window.parent;
  const frame = window.frameElement;
  const root = document.documentElement;
  const selector = '[data-workspace-placement-control]';
  const style = document.createElement('style');
  style.textContent = `
    html body .msp-plugin .msp-highlight-toast-wrapper {
      bottom: max(8px, var(--burette-host-control-clearance, 0px));
      right: var(--burette-tooltip-right, 8px);
      max-width: calc(100% - var(--burette-tooltip-right, 8px) - 8px);
    }
    html body .msp-plugin .msp-highlight-info {
      box-sizing: border-box;
      max-width: min(400px, calc(100vw - var(--burette-tooltip-right, 8px) - 16px));
      white-space: normal;
      overflow-wrap: anywhere;
    }
    html body .msp-plugin .msp-highlight-info * { white-space: normal; overflow-wrap: anywhere; }
    [data-burette-host-control-active] .msp-highlight-info { visibility: hidden !important; }
  `;
  document.head.appendChild(style);
  let control;
  let hovered = false;
  const update = () => {
    const next = host.document.querySelector(selector);
    if (next !== control) {
      if (control) resize.unobserve(control);
      control = next;
      hovered = Boolean(control?.matches(':hover'));
      if (control) resize.observe(control);
    }
    const viewport = frame.getBoundingClientRect();
    const bounds = control?.getBoundingClientRect();
    const overlaps = bounds && bounds.width > 0 && bounds.height > 0 &&
      bounds.left < viewport.right && bounds.right > viewport.left &&
      bounds.top < viewport.bottom && bounds.bottom > viewport.top;
    const clearance = overlaps ? Math.ceil(viewport.bottom - bounds.top + 8) : 0;
    root.style.setProperty('--burette-host-control-clearance', `${clearance}px`);
    // Raising the label must not put it underneath the right-hand viewer rail.
    const rail = document.querySelector('.buret-viewport-rail')?.getBoundingClientRect();
    const right = rail?.width > 0 && rail.height > 0 && rail.left > window.innerWidth * 0.75
      ? Math.ceil(window.innerWidth - rail.left + 8) : 8;
    root.style.setProperty('--burette-tooltip-right', `${right}px`);
    root.toggleAttribute('data-burette-host-control-active', Boolean(overlaps &&
      (hovered || control.querySelector('[aria-expanded="true"]'))));
  };
  const pointer = event => {
    const target = event.type === 'pointerout' ? event.relatedTarget : event.target;
    hovered = Boolean(target?.closest?.(selector));
    update();
  };
  const resize = new ResizeObserver(update);
  resize.observe(frame);
  const mutation = new MutationObserver(update);
  mutation.observe(host.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });
  const previewMutation = new MutationObserver(update);
  previewMutation.observe(document.body, { childList: true, subtree: true });
  host.document.addEventListener('pointerover', pointer);
  host.document.addEventListener('pointerout', pointer);
  host.addEventListener('resize', update);
  update();
  return () => {
    resize.disconnect();
    mutation.disconnect();
    previewMutation.disconnect();
    host.document.removeEventListener('pointerover', pointer);
    host.document.removeEventListener('pointerout', pointer);
    host.removeEventListener('resize', update);
    root.style.removeProperty('--burette-host-control-clearance');
    root.style.removeProperty('--burette-tooltip-right');
    root.removeAttribute('data-burette-host-control-active');
    style.remove();
  };
}
