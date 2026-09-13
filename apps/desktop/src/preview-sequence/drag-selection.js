/* Keep Mol*'s range picking, adding edge scrolling and a visible drag preview. */
export function bindSequenceDrag(panel) {
  const doc = panel.ownerDocument;
  let drag, frame = 0, forwarding = false;
  const modifiers = event => ({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey });
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    const endpoint = drag?.cells[drag.last].node;
    drag?.marked.forEach(node => node.removeAttribute('data-buret-drag-selected'));
    drag = undefined;
    // A release outside the clipped row has no later native leave event.
    endpoint?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: doc.body }));
  }
  function updateEndpoint() {
    if (!drag) return;
    const { reading, cells, originScroll, x, y } = drag;
    const bounds = reading.getBoundingClientRect();
    const px = Math.max(bounds.left + 2, Math.min(x, bounds.right - 12)) + reading.scrollLeft - originScroll.x;
    const py = Math.max(bounds.top + 2, Math.min(y, bounds.bottom - 8)) + reading.scrollTop - originScroll.y;
    let best = drag.last, distance = Infinity;
    cells.forEach(({ rect }, index) => {
      const dx = Math.max(rect.left - px, 0, px - rect.right);
      const dy = Math.max(rect.top - py, 0, py - rect.bottom);
      const score = dy * 10000 + dx;
      if (score < distance) { best = index; distance = score; }
    });
    if (best === drag.last && drag.marked.size) return;
    drag.last = best;
    const low = Math.min(drag.start, best), high = Math.max(drag.start, best);
    const marked = new Set(cells.slice(low, high + 1).map(cell => cell.node));
    drag.marked.forEach(node => { if (!marked.has(node)) node.removeAttribute('data-buret-drag-selected'); });
    marked.forEach(node => { if (!drag.marked.has(node)) node.setAttribute('data-buret-drag-selected', ''); });
    drag.marked = marked;
    forwarding = true;
    cells[best].node.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: x, clientY: y, ...drag.modifiers }));
    forwarding = false;
  }
  function step(time) {
    frame = 0;
    if (!drag || !panel.isConnected) { stop(); return; }
    const bounds = drag.reading.getBoundingClientRect();
    const elapsed = Math.min(32, drag.time ? time - drag.time : 16);
    drag.time = time;
    const speed = (position, start, end) => position < start + 24
      ? -Math.min(1, (start + 24 - position) / 24)
      : position > end - 24 ? Math.min(1, (position - end + 24) / 24) : 0;
    drag.reading.scrollLeft += speed(drag.x, bounds.left, bounds.right) * elapsed * .6;
    drag.reading.scrollTop += speed(drag.y, bounds.top, bounds.bottom) * elapsed * .6;
    updateEndpoint();
    frame = requestAnimationFrame(step);
  }
  function down(event) {
    if (event.button !== 0) return;
    const node = event.target.closest?.('[data-seqid]');
    if (!node && event.target.closest?.('.msp-sequence-wrapper-non-empty')) {
      event.stopPropagation();
      return;
    }
    const wrapper = node?.closest('.msp-sequence-wrapper');
    const reading = wrapper?.closest('.msp-sequence-wrapper-non-empty');
    if (!reading) return;
    stop();
    const nodes = Array.from(wrapper.querySelectorAll('[data-seqid]'));
    if (nodes.length > 10000) return;
    const start = nodes.indexOf(node);
    drag = { reading, wrapper, start, last: start, x: event.clientX, y: event.clientY,
      modifiers: modifiers(event), marked: new Set(), originScroll: { x: reading.scrollLeft, y: reading.scrollTop },
      cells: nodes.map(node => ({ node, rect: node.getBoundingClientRect() })) };
    // Do not capture the pointer: Mol* must receive the original down event.
    frame = requestAnimationFrame(step);
  }
  function move(event) {
    if (!drag || forwarding) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.modifiers = modifiers(event);
    updateEndpoint();
  }
  function out(event) {
    // Mol* otherwise cancels its drag when the pointer leaves the clipped row.
    if (drag && drag.wrapper.contains(event.target) && !drag.wrapper.contains(event.relatedTarget)) event.stopPropagation();
  }
  function up(event) {
    if (forwarding || event.button !== 0) return;
    if (!drag) {
      if (event.target.closest?.('.msp-sequence-wrapper-non-empty') && !event.target.closest?.('[data-seqid]')) event.stopPropagation();
      return;
    }
    move(event);
    const node = drag.cells[drag.last].node;
    const options = { bubbles: true, button: 0, buttons: 0, clientX: drag.x, clientY: drag.y, ...modifiers(event) };
    event.stopPropagation();
    forwarding = true;
    node.dispatchEvent(new MouseEvent('mouseup', options));
    forwarding = false;
    stop();
  }
  panel.addEventListener('mousedown', down, true);
  doc.addEventListener('mousemove', move, true);
  doc.addEventListener('mouseout', out, true);
  doc.addEventListener('mouseup', up, true);
  doc.addEventListener('pointercancel', stop, true);
  doc.defaultView.addEventListener('blur', stop);
  return () => {
    stop();
    panel.removeEventListener('mousedown', down, true);
    doc.removeEventListener('mousemove', move, true);
    doc.removeEventListener('mouseout', out, true);
    doc.removeEventListener('mouseup', up, true);
    doc.removeEventListener('pointercancel', stop, true);
    doc.defaultView.removeEventListener('blur', stop);
  };
}
