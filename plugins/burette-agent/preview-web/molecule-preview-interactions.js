(function () {
  'use strict';

  function inside(point, polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }

  function install(image, onSelect) {
    image._burettePreviewDispose?.();
    const svg = image.querySelector('svg');
    if (!svg) return;
    const abort = new AbortController();
    const signal = abort.signal;
    const initial = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    const atoms = [...svg.querySelectorAll('.buret-preview-atom')];
    const button = image.parentElement.querySelector('[data-buret-molecule-preview-action="lasso"]');
    if (button) button.disabled = atoms.length === 0;
    let enabled = false;
    let points = null;
    let pointerId = null;
    let zoom = 1;
    let outline = null;
    const pointAt = event => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    };
    const cancel = () => {
      outline?.remove();
      outline = null;
      points = null;
      if (pointerId !== null && image.hasPointerCapture(pointerId)) image.releasePointerCapture(pointerId);
      pointerId = null;
    };
    const setEnabled = value => {
      cancel();
      enabled = value;
      image.classList.toggle('buret-preview-lasso-active', value);
      button?.setAttribute('aria-pressed', String(value));
    };
    image._burettePreviewDispose = () => { setEnabled(false); abort.abort(); };
    image.addEventListener('burette-toggle-lasso', () => setEnabled(!enabled), { signal });
    image.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      if (points) return;
      const anchor = pointAt(event);
      const old = svg.viewBox.baseVal;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? image.clientHeight : 1);
      const next = Math.max(1, Math.min(8, zoom * Math.exp(-delta * 0.002)));
      if (next === 1) {
        svg.setAttribute('viewBox', initial.join(' '));
        zoom = 1;
        return;
      }
      const factor = zoom / next;
      svg.setAttribute('viewBox', [anchor.x + (old.x - anchor.x) * factor,
        anchor.y + (old.y - anchor.y) * factor, old.width * factor, old.height * factor].join(' '));
      zoom = next;
    }, { passive: false, signal });
    image.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      if (enabled) return;
      svg.setAttribute('viewBox', initial.join(' '));
      zoom = 1;
    }, { signal });
    image.addEventListener('pointerdown', event => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
      pointerId = event.pointerId;
      image.setPointerCapture(pointerId);
      points = [pointAt(event)];
      outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      outline.setAttribute('class', 'buret-preview-lasso-path');
      svg.appendChild(outline);
    }, { signal });
    image.addEventListener('pointermove', event => {
      if (!points || event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (points.length < 2048) points.push(pointAt(event));
      outline.setAttribute('d', points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z');
    }, { signal });
    image.addEventListener('pointerup', event => {
      if (!points || event.pointerId !== pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      points.push(pointAt(event));
      const selected = atoms.filter(atom => inside({ x: Number(atom.getAttribute('cx')), y: Number(atom.getAttribute('cy')) }, points));
      for (const atom of atoms) atom.classList.toggle('buret-preview-atom-selected', selected.includes(atom));
      cancel();
      onSelect(selected.map(atom => atom.dataset.sourcePosition?.split(',').map(Number)).filter(position => position?.length === 3 && position.every(Number.isFinite)));
    }, { signal });
    image.addEventListener('pointercancel', cancel, { signal });
    image.addEventListener('lostpointercapture', cancel, { signal });
    image.parentElement.addEventListener('keydown', event => {
      if (event.key === 'Escape' && enabled) {
        event.preventDefault();
        event.stopPropagation();
        setEnabled(false);
      }
    }, { signal });
  }

  window.BuretteMoleculePreviewInteractions = { install };
})();
