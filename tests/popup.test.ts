const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function setup(t, url, connected = true, options = {}) {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const messages = [], saved = [], injections = [];
  let ready = connected;
  dom.window.chrome = {
    runtime: { getManifest: () => ({ version: '1.0.5' }) },
    storage: { local: {
      async get(defaults) { return defaults; },
      async set(value) { saved.push(value); }
    } },
    tabs: {
      async query() { return [{ id: 1, url }]; },
      async sendMessage(id, message) {
        if (!ready) {
          if (options.emptyResponse) return undefined;
          throw Error('No receiver');
        }
        messages.push(message);
        if (message.type === 'chat-fold:v2:set-all' || message.type === 'chat-fold:v2:set-users') return { ok: true };
        return { protocol: 2, version: options.pageVersion || '1.0.5', provider: 'ChatGPT', total: 3, collapsed: 2, enabled: true, users: {enabled: true, lines: 1, total: 2, collapsed: 2} };
      }
    },
    scripting: {
      async insertCSS(options) { injections.push(options); },
      async executeScript(args) {
        injections.push(args);
        if (options.probeFails) throw Error('Cannot access https://chatgpt.com/c/private-conversation-id');
        ready = true;
        return [{ result: undefined }];
      }
    }
  };
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../build/popup/popup.js'), 'utf8'));
  await new Promise(resolve => setTimeout(resolve, 10));
  return { document: dom.window.document, window: dom.window, messages, saved, injections };
}

test('popup shows conversation state and sends bulk actions', async t => {
  const app = await setup(t, 'https://chatgpt.com/c/test');
  assert.match(app.document.getElementById('status').textContent, /3 次回答 · 2 次已收起/);
  assert.equal(app.document.getElementById('collapse').disabled, false);
  app.document.getElementById('expand').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(app.messages.some(message => message.type === 'chat-fold:v2:set-all' && message.collapsed === false));
  const input = app.document.getElementById('enabled');
  input.checked = false;
  input.dispatchEvent(new app.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.saved[0].enabled, false);
});

test('popup safely disables conversation actions on other websites', async t => {
  const app = await setup(t, 'https://example.com/');
  assert.match(app.document.getElementById('status').textContent, /ChatGPT 页面/);
  assert.equal(app.document.getElementById('collapse').disabled, true);
  assert.equal(app.messages.length, 0);
});

test('popup has no diagnostic controls or redundant descriptions', async t => {
  const app = await setup(t, 'https://chatgpt.com/');
  assert.equal(app.document.querySelector('details, textarea, small, #provider, #user-status'), null);
  assert.equal(app.document.getElementById('collapse').textContent, app.document.getElementById('collapse-users').textContent);
  assert.equal(app.document.getElementById('expand').textContent, app.document.getElementById('expand-users').textContent);
  assert.deepEqual([...app.document.querySelectorAll('main section')].map(section => section.className), ['auto-folding', 'conversation', 'user-folding']);
});

test('undefined message responses trigger reinjection and a new handshake', async t => {
  const app = await setup(t, 'https://chatgpt.com/', false, { emptyResponse: true });
  assert.match(app.document.getElementById('status').textContent, /3 次回答/);
  assert.ok(app.injections.some(call => call.files?.includes('build/content/engine.js')));
  assert.ok(app.injections.some(call => call.files?.includes('content/content.css')));
  assert.equal(app.injections.some(call => call.files?.includes('build/content/probe.js')), false);
});

test('connection failures show a short hint without leaking page URLs', async t => {
  const app = await setup(t, 'https://chatgpt.com/', false, { probeFails: true });
  assert.match(app.document.getElementById('status').textContent, /刷新 ChatGPT/);
  assert.doesNotMatch(app.document.body.textContent, /private-conversation-id|https:/);
  assert.equal(app.document.getElementById('collapse').disabled, true);
  assert.equal(app.document.getElementById('collapse-users').disabled, true);
});

test('an outdated engine is reinjected and must pass the version check', async t => {
  const app = await setup(t, 'https://chatgpt.com/', true, { pageVersion: '1.0.2' });
  assert.match(app.document.getElementById('status').textContent, /刷新/);
  assert.equal(app.document.getElementById('collapse').disabled, true);
  assert.ok(app.injections.some(call => call.files?.includes('build/content/engine.js')));
});

test('user controls persist their independent toggle and positive integer line limit', async t => {
  const app = await setup(t, 'https://chatgpt.com/');
  const lines = app.document.getElementById('userLines');
  assert.equal(lines.value, '1');
  assert.equal(app.document.getElementById('expand-users').disabled, false);
  lines.value = '3';
  lines.dispatchEvent(new app.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.saved.at(-1).userLines, 3);
  for (const value of ['', '0', '-2', '1.5']) {
    const count = app.saved.length;
    lines.value = value;
    lines.dispatchEvent(new app.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(app.saved.length, count);
    assert.equal(lines.value, '3');
  }
  app.document.getElementById('expand-users').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(app.messages.some(message => message.type === 'chat-fold:v2:set-users' && message.collapsed === false));
  const toggle = app.document.getElementById('userEnabled');
  toggle.checked = false;
  toggle.dispatchEvent(new app.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(app.saved.at(-1).userEnabled, false);
  assert.equal(lines.disabled, true);
});
