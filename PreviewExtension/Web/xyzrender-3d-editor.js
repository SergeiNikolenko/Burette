(() => {
  'use strict';
  async function open(options) {
    document.querySelector('.buret-xyzrender-3d-dialog')?.close();
    const dialog = document.createElement('dialog');
    dialog.className = 'buret-xyzrender-3d-dialog';
    dialog.setAttribute('aria-label', 'xyzrender animation');
    dialog.innerHTML = `<header><strong>xyzrender animation</strong><span></span><button data-close>Close</button></header>
      <div class="buret-xyzrender-3d-stage"><img alt="xyzrender animation preview" style="width:100%;height:100%;object-fit:contain" hidden></div>
      <footer><select aria-label="Animation"><option value="rotation">Rotation</option><option value="bounce">Rock ±45°</option><option value="trajectory">Trajectory</option></select>
      <select aria-label="Rotation axis"><option>x</option><option selected>y</option><option>z</option></select>
      <button data-render hidden>Retry</button><button data-export disabled>Save GIF</button></footer>
      <p role="status">Rendered by xyzrender · current style · 480 px · 10 fps</p>`;
    dialog.querySelector('header span').textContent = options.label;
    document.body.appendChild(dialog);
    dialog.showModal();
    const status = dialog.querySelector('[role=status]');
    const image = dialog.querySelector('img');
    const mode = dialog.querySelector('[aria-label="Animation"]');
    const axis = dialog.querySelector('[aria-label="Rotation axis"]');
    const render = dialog.querySelector('[data-render]');
    const save = dialog.querySelector('[data-export]');
    let closed = false, url, blob, renderedMode;
    if (options.previewSvg) {
      url = URL.createObjectURL(new Blob([options.previewSvg], { type: 'image/svg+xml' }));
      image.src = url;
      image.hidden = false;
    }
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.addEventListener('close', () => {
      closed = true;
      if (url) URL.revokeObjectURL(url);
      dialog.remove();
    }, { once: true });
    save.onclick = () => options.download(blob, `${options.label.replace(/\.[^.]+$/, '')}-${renderedMode}.gif`);
    render.onclick = async () => {
      render.hidden = true; render.disabled = true; save.disabled = true; mode.disabled = true; axis.disabled = true;
      status.textContent = 'Rendering with xyzrender…';
      try {
        const payload = await options.render({ mode: mode.value, axis: axis.value });
        if (closed) return;
        if (!payload.gifBase64) throw new Error('xyzrender returned no animation.');
        blob = new Blob([Uint8Array.from(atob(payload.gifBase64), c => c.charCodeAt(0))], { type: 'image/gif' });
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(blob);
        image.src = url; image.hidden = false;
        renderedMode = mode.value;
        save.disabled = false;
        status.textContent = 'xyzrender preview · 480 px · 10 fps';
      } catch (error) {
        if (!closed) { status.textContent = error.message || String(error); render.hidden = false; }
      } finally {
        render.disabled = false; mode.disabled = false; axis.disabled = mode.value === 'trajectory';
      }
    };
    mode.onchange = render.onclick;
    axis.onchange = render.onclick;
    await render.onclick();
  }
  window.BuretteXyzrender3D = { open };
})();
