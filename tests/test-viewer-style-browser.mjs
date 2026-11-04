// Run after build:viewer-controls, with the same browser binaries as workspace QA.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
try {
  const page = await browser.newPage();
  await page.setContent('<div id="app"></div>');
  await page.addStyleTag({ content: await readFile('PreviewExtension/Web/viewer-runtime.css', 'utf8') });
  await page.addScriptTag({ content: await readFile('PreviewExtension/Web/viewer-shell.js', 'utf8') });
  await page.addScriptTag({ content: await readFile(process.env.VIEWER_CONTROLS_BUNDLE || 'PreviewExtension/Web/native-viewer-menus.js', 'utf8') });
  for (const theme of ['light', 'dark']) {
    const result = await page.evaluate(theme => {
      document.documentElement.classList.remove('buret-viewer-booting');
      window.BuretteViewerShell.mountToolbar();
      const toolbar = document.querySelector('#buret-toolbar');
      window.BuretteNativeViewerMenus.styleToolbar(toolbar, undefined, theme);
      const grip = toolbar.querySelector('[data-drag-handle]');
      const hint = document.createElement('div');
      hint.textContent = 'Animate the scene';
      document.body.append(hint);
      window.BuretteNativeViewerMenus.styleTooltip(hint, undefined, theme);
      const style = getComputedStyle(hint);
      const result = {
        theme, gripHeight: grip.getBoundingClientRect().height,
        iconWidth: grip.querySelector('svg').getBoundingClientRect().width,
        fontSize: style.fontSize, padding: style.paddingLeft,
        background: style.backgroundColor, radius: style.borderRadius,
      };
      hint.remove();
      return result;
    }, theme);
    assert.ok(result.gripHeight >= 24, JSON.stringify(result));
    assert.ok(result.iconWidth >= 12, JSON.stringify(result));
    assert.ok(parseFloat(result.fontSize) <= 14, JSON.stringify(result));
    assert.equal(result.padding, '12px', JSON.stringify(result));
    assert.notEqual(result.background, 'rgba(0, 0, 0, 0)', JSON.stringify(result));
    assert.notEqual(result.radius, '0px', JSON.stringify(result));
    console.log(JSON.stringify(result));
  }
} finally { await browser.close(); }
