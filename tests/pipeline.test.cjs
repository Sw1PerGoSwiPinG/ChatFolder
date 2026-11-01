const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

async function pipeline(t, initiallyInjected) {
  const page = new JSDOM('<svg><path></path></svg><div id="app"></div>', {
    url: 'https://chatgpt.com/c/private-id', runScripts: 'outside-only'
  });
  const popup = new JSDOM(read('popup/popup.html'), { runScripts: 'outside-only' });
  t.after(() => { page.window.close(); popup.window.close(); });
  const root = page.window.document.querySelector('#app').attachShadow({ mode: 'open' });
  root.innerHTML = '<article data-turn="user">Private question</article><article data-turn="assistant"><div class="markdown">Private answer</div></article>';
  const listeners = new Set(), storageListeners = new Set();
  const chrome = {
    runtime: { getManifest: () => manifest,
      onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
    storage: { local: { async get(defaults) { return defaults; } },
      onChanged: { addListener: fn => storageListeners.add(fn), removeListener: fn => storageListeners.delete(fn) } },
    dom: { openOrClosedShadowRoot(element) {
      if (!(element instanceof element.ownerDocument.defaultView.HTMLElement)) throw new TypeError('HTMLElement required');
      return null;
    } },
    tabs: {
      async query() { return [{ id: 1, url: page.window.location.href }]; },
      async sendMessage(id, message) {
        let response;
        for (const listener of listeners) listener(message, {}, value => { response = value; });
        return response;
      }
    },
    scripting: {
      async insertCSS() {},
      async executeScript(args) {
        if (args.files) {
          for (const file of args.files) page.window.eval(read(file));
          // Intentionally discard file completion values, as the popup must not rely on them.
          return [{ frameId: 0, result: undefined }];
        }
        return [{ frameId: 0, result: page.window.eval(`(${args.func.toString()})()`) }];
      }
    }
  };
  page.window.chrome = chrome;
  popup.window.chrome = chrome;
  if (initiallyInjected) for (const file of manifest.content_scripts[0].js) page.window.eval(read(file));
  await new Promise(resolve => setTimeout(resolve, 10));
  popup.window.eval(read('popup/popup.js'));
  await new Promise(resolve => setTimeout(resolve, 20));
  return { page, popup, root };
}

for (const initiallyInjected of [true, false]) {
  test(`actual popup and engine pipeline works with nested chat and SVG (initial script: ${initiallyInjected})`, async t => {
    const { popup, root } = await pipeline(t, initiallyInjected);
    assert.match(popup.window.document.getElementById('status').textContent, /1 次回答 · 1 次已收起/);
    assert.ok(root.querySelector('[data-chat-fold-control]'));
    popup.window.document.getElementById('diagnose').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    const diagnostic = JSON.parse(popup.window.document.getElementById('diagnosticOutput').value);
    assert.equal(diagnostic.extensionVersion, manifest.version);
    assert.equal(diagnostic.engineError, null);
    assert.equal(diagnostic.structure.articles, 0);
    assert.equal(diagnostic.nested.contexts.find(context => context.kind === 'shadow').controls, 1);
    assert.doesNotMatch(JSON.stringify(diagnostic), /Private question|Private answer|private-id/);
    popup.window.document.getElementById('expand').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(root.querySelectorAll('[data-chat-fold-hidden]').length, 0);
    assert.match(popup.window.document.getElementById('status').textContent, /0 次已收起/);
  });
}
