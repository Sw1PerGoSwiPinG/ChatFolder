const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const markup = (id = 'shared') => `<div data-turn-key="${id}"><div data-user-message-bubble>Private input body</div></div><article><div data-message-author-role="assistant" data-message-id="${id}">Private answer body</div></article>`;
const PREFIX = 'chatfolder:state:v1:';
const stateKey = (kind, id = 'shared', conversation = 'first') => PREFIX + JSON.stringify(['chatgpt', conversation, kind, id]);
function storage(initial = {}, options = {}) {
  const data = { ...initial }, listeners = new Set(), writes = [];
  return { data, listeners, writes, local: {
    async get(keys) {
      const snapshot = { ...data };
      if (options.delay) await wait(options.delay);
      if (options.readFails) throw Error('Storage unavailable');
      return keys === null ? snapshot : { ...keys, ...snapshot };
    },
    async set(batch) {
      writes.push({ ...batch });
      if (options.writeFails) throw Error('Quota exceeded');
      if (options.delayWrite) await wait(options.delayWrite);
      const changes = {};
      for (const [key, value] of Object.entries(batch)) {
        changes[key] = { oldValue: data[key], newValue: value }; data[key] = value;
      }
      for (const listener of listeners) listener(changes, 'local');
    }
  } };
}
async function page(t, store, url = '/c/first', html = markup(), settle = true) {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://chatgpt.com' + url, runScripts: 'outside-only' });
  const w = dom.window, handlers = new Set();
  w.chrome = {
    runtime: { getManifest: () => manifest, onMessage: { addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn) } },
    storage: { local: store.local, onChanged: { addListener: fn => store.listeners.add(fn), removeListener: fn => store.listeners.delete(fn) } }
  };
  for (const file of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const close = () => { w.__chatFoldRuntime.destroy(); w.close(); };
  t.after(close);
  if (settle) await wait();
  return {
    w, close,
    async message(type, extra = {}) {
      return await new Promise(resolve => { for (const fn of handlers) fn({ type: 'chat-fold:v2:' + type, ...extra }, {}, resolve); });
    },
    answerButton: () => w.document.querySelector('[data-chat-fold-control]:not([data-chat-fold-user-control])').shadowRoot.querySelector('button'),
    userButton: () => w.document.querySelector('[data-chat-fold-user-control]').shadowRoot.querySelector('button')
  };
}

test('answer and input choices restore after reload; saved choices override new defaults', async t => {
  const store = storage();
  const a = await page(t, store);
  a.answerButton().click(); a.userButton().click(); await wait();
  assert.equal(store.data[stateKey('answer')], false);
  assert.equal(store.data[stateKey('user')], true);
  a.close();
  const b = await page(t, store);
  assert.equal((await b.message('status')).collapsed, 0);
  assert.equal((await b.message('status')).users.collapsed, 1);
  assert.equal(b.answerButton().getAttribute('aria-expanded'), 'true');
  const payload = JSON.stringify(store.writes);
  assert.doesNotMatch(payload, /Private input|Private answer|https:|query|title/);
  assert.ok(Object.values(store.data).every(value => typeof value === 'boolean'));
});

test('SPA navigation isolates conversations and restores previous choices on return', async t => {
  const store = storage(); const a = await page(t, store);
  a.answerButton().click(); a.userButton().click();
  a.w.history.pushState({}, '', '/c/second'); a.w.document.querySelector('main').innerHTML = markup();
  let status = await a.message('status');
  assert.equal(status.collapsed, 1); assert.equal(status.users.collapsed, 0);
  a.w.history.pushState({}, '', '/c/first'); a.w.document.querySelector('main').innerHTML = markup();
  status = await a.message('status');
  assert.equal(status.collapsed, 0); assert.equal(status.users.collapsed, 1);
});

test('project and ordinary URLs identify the same conversation; newly discovered messages use defaults', async t => {
  const store = storage({ [stateKey('answer')]: false, [stateKey('user')]: true, defaultCollapsed: false });
  const a = await page(t, store, '/g/project/c/first?view=private');
  assert.equal((await a.message('status')).users.collapsed, 1);
  a.w.document.querySelector('main').insertAdjacentHTML('beforeend', markup('new-message'));
  assert.equal((await a.message('status')).collapsed, 0);
  await wait();
  assert.equal(store.data[stateKey('answer', 'new-message')], false);
});

test('bulk operations persist for both kinds and pausing does not erase them', async t => {
  const store = storage(); const a = await page(t, store, '/c/first', markup('a') + markup('b'));
  await a.message('set-all', { collapsed: false }); await a.message('set-users', { collapsed: true }); await wait();
  await store.local.set({ enabled: false, userEnabled: false });
  assert.equal(a.w.document.querySelector('[data-chat-fold-control]'), null);
  await store.local.set({ enabled: true, userEnabled: true });
  a.close(); const b = await page(t, store, '/c/first', markup('a') + markup('b'));
  const status = await b.message('status'); assert.equal(status.collapsed, 0); assert.equal(status.users.collapsed, 2);
});

test('different tabs update independent entries without losing choices and reflect remote changes', async t => {
  const store = storage({}, { delayWrite: 5 });
  const a = await page(t, store), b = await page(t, store, '/c/first', markup('other'));
  a.answerButton().click(); b.userButton().click(); await wait(50);
  const c = await page(t, store, '/c/first', markup() + markup('other'));
  let status = await c.message('status'); assert.equal(status.collapsed, 1); assert.equal(status.users.collapsed, 1);
  await store.local.set({ [stateKey('answer')]: true });
  status = await a.message('status'); assert.equal(status.collapsed, 1);
});

test('rapid toggles keep the last choice even while previous writes are in flight', async t => {
  const store = storage({}, { delayWrite: 10 }); const a = await page(t, store);
  for (let i = 0; i < 5; i++) { a.answerButton().click(); a.userButton().click(); }
  await wait(100); a.close(); const b = await page(t, store);
  const status = await b.message('status'); assert.equal(status.collapsed, 0); assert.equal(status.users.collapsed, 1);
});

test('messages wait for delayed history hydration rather than overwriting saved choices', async t => {
  const store = storage({ [stateKey('answer')]: false, [stateKey('user')]: true }, { delay: 30 });
  const a = await page(t, store, '/c/first', markup(), false);
  const status = await a.message('status');
  assert.equal(status.collapsed, 0); assert.equal(status.users.collapsed, 1); assert.equal(store.writes.length, 0);
});

test('malformed values and unavailable storage never prevent folding', async t => {
  const store = storage({ [stateKey('answer')]: { collapsed: false }, [stateKey('user')]: 'true' }, { writeFails: true });
  const a = await page(t, store); a.answerButton().click();
  assert.equal((await a.message('status')).collapsed, 0);
  assert.equal((await a.message('status')).users.collapsed, 0);
  const b = await page(t, storage({}, { readFails: true, writeFails: true }));
  assert.equal((await b.message('status')).error, null);
  b.userButton().click(); assert.equal((await b.message('status')).users.collapsed, 1);
});

test('unnamed chats and positional message selectors are never persisted', async t => {
  const store = storage(); const a = await page(t, store, '/');
  a.answerButton().click(); a.userButton().click(); await wait(); assert.equal(store.writes.length, 0);
  const b = await page(t, store, '/c/first', '<article data-testid="conversation-turn-0"><div data-message-author-role="assistant">No stable ID</div></article>');
  b.answerButton().click(); await wait(); assert.equal(store.writes.length, 0);
});


test('a failed hydration does not overwrite unknown saved states with defaults', async t => {
  const store = storage({ [stateKey('answer')]: false, [stateKey('user')]: true }, { readFails: true });
  const a = await page(t, store);
  assert.equal((await a.message('status')).error, null);
  await wait();
  assert.equal(store.writes.length, 0);
  assert.equal(store.data[stateKey('answer')], false);
  assert.equal(store.data[stateKey('user')], true);
});
