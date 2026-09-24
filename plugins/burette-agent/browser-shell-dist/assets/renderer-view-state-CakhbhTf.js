// Presentation state only: source coordinates and rendered SVG data stay untouched.
(function () {
  'use strict';
  const storageKey = 'burette.renderer-views.v1';
  let memory = {};
  function readAll() {
    try {
      const text = window.sessionStorage.getItem(storageKey);
      if (text && text.length < 256000) memory = JSON.parse(text);
    } catch (_) {}
    return memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  }
  function camera(value) {
    if (!value || !['position', 'target', 'up'].every(key =>
      Array.isArray(value[key]) && value[key].length === 3 && value[key].every(Number.isFinite))) return null;
    if (!(value.radius > 0) || !Number.isFinite(value.radius)) return null;
    const result = { position: value.position.slice(), target: value.target.slice(), up: value.up.slice(), radius: value.radius };
    for (const key of ['fov', 'radiusMax', 'fog', 'clipFar', 'minNear', 'minFar']) {
      if (Number.isFinite(value[key])) result[key] = value[key];
    }
    if (value.mode === 'perspective' || value.mode === 'orthographic') result.mode = value.mode;
    return result;
  }
  function xyz(value) {
    if (!value || !['scale', 'x', 'y'].every(key => Number.isFinite(value[key]))) return null;
    if (value.scale < 0.05 || value.scale > 8) return null;
    const result = { scale: value.scale, x: value.x, y: value.y };
    if (value.item && ['left', 'top', 'width', 'height', 'rotation'].every(key => Number.isFinite(value.item[key]))) {
      result.item = Object.fromEntries(['left', 'top', 'width', 'height', 'rotation'].map(key => [key, value.item[key]]));
    }
    if (value.viewport && ['width', 'height'].every(key => Number.isFinite(value.viewport[key]) && value.viewport[key] > 0)) {
      result.viewport = { width: value.viewport.width, height: value.viewport.height };
    }
    return result;
  }
  // Keep the user's zoom and sheet geometry when docks resize the viewport.
  // Pin responsive item sizes once; move layout centers by the viewport delta.
  function observeSheetViewport(root, initialViewport) {
    let width = initialViewport?.width || root.clientWidth;
    let height = initialViewport?.height || root.clientHeight;
    const pinned = new WeakSet();
    const resize = () => {
      const nextWidth = root.clientWidth, nextHeight = root.clientHeight;
      if (!nextWidth || !nextHeight) return;
      const dx = width ? (nextWidth - width) / 2 : 0;
      const dy = height ? (nextHeight - height) / 2 : 0;
      for (const item of root.querySelectorAll('.buret-xyzrender-sheet-item')) {
        if (!pinned.has(item)) {
          item.style.width = `${item.offsetWidth}px`;
          item.style.height = `${item.offsetHeight}px`;
          item.style.left = `${item.offsetLeft}px`;
          item.style.top = `${item.offsetTop}px`;
          pinned.add(item);
        }
        item.style.left = `${parseFloat(item.style.left) + dx}px`;
        item.style.top = `${parseFloat(item.style.top) + dy}px`;
      }
      width = nextWidth; height = nextHeight;
    };
    resize();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(root);
    return () => observer?.disconnect();
  }
  function read(id, initial) {
    if (typeof id !== 'string' || !id || id.length > 2048) return {};
    const values = readAll();
    let value = Object.hasOwn(values, id) ? values[id] : null;
    if (!value && typeof initial === 'string' && initial.length <= 8192) {
      try { value = JSON.parse(initial); } catch (_) {}
      if (value) { save(id, value); }
    }
    return value ? { camera: camera(value.camera), xyz: xyz(value.xyz) } : {};
  }
  function save(id, patch) {
    if (typeof id !== 'string' || !id || id.length > 2048) return;
    const values = readAll();
    const previous = read(id);
    delete values[id];
    values[id] = {
      camera: camera(patch.camera) || previous.camera || null,
      xyz: xyz(patch.xyz) || previous.xyz || null
    };
    for (const key of Object.keys(values).slice(0, -32)) delete values[key];
    memory = values;
    try { window.sessionStorage.setItem(storageKey, JSON.stringify(values)); } catch (_) {}
  }
  window.BuretteRendererViewState = { read, save, observeSheetViewport };
})();
