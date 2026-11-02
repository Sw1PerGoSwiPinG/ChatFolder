const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const answer = (id, text = 'A long answer') => `<article data-testid="conversation-turn-${id}"><div data-message-author-role="assistant" data-message-id="${id}">${text}</div><div class="actions">Copy answer</div></article>`;
const user = '<article data-testid="conversation-turn-user"><div data-message-author-role="user">My question</div></article>';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t, html = user + answer('a'), settings = {}, trustedTypes = false) {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://chatgpt.com/c/first', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  if (trustedTypes) Object.defineProperty(window.ShadowRoot.prototype, 'innerHTML', {
    set() { throw new TypeError('TrustedHTML required'); }
  });
  let onMessage, onChange;
  window.chrome = {
    runtime: { getManifest: () => ({ version: '1.0.5' }), onMessage: {
      addListener(fn) { onMessage = fn; }, removeListener(fn) { if (onMessage === fn) onMessage = null; }
    } },
    storage: {
      local: { async get(defaults) { return { ...defaults, ...settings }; } },
      onChanged: { addListener(fn) { onChange = fn; }, removeListener(fn) { if (onChange === fn) onChange = null; } }
    }
  };
  for (const file of ['build/content/dom.js', 'build/content/registry.js', 'build/content/adapters/chatgpt.js', 'build/content/engine.js']) {
    window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
  await sleep(10);
  return {
    window, document: window.document,
    controls: () => [...window.document.querySelectorAll('[data-chat-fold-control]')],
    message: message => { let result; onMessage(message, {}, value => { result = value; }); return result; },
    change: changes => onChange(changes, 'local')
  };
}

test('collapses the whole answer, preserves the user, and toggles accessibly', async t => {
  const app = await setup(t);
  const article = app.document.querySelector('[data-testid="conversation-turn-a"]');
  assert.equal(article.getAttribute('data-chat-fold-hidden'), 'true');
  assert.equal(app.document.querySelector('[data-message-author-role="user"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(article.querySelector('.actions').textContent, 'Copy answer');
  const button = app.controls()[0].shadowRoot.querySelector('button');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  button.click();
  assert.equal(article.hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  button.click();
  assert.equal(article.getAttribute('data-chat-fold-hidden'), 'true');
});

test('streaming, new turns and stable message replacement preserve independent choices', async t => {
  const app = await setup(t);
  app.controls()[0].shadowRoot.querySelector('button').click();
  app.document.querySelector('[data-message-id="a"]').append(' streamed words');
  app.document.querySelector('main').insertAdjacentHTML('beforeend', answer('b'));
  await sleep(110);
  assert.equal(app.controls().length, 2);
  assert.equal(app.document.querySelector('[data-message-id="a"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(app.document.querySelector('[data-message-id="b"]').closest('article').getAttribute('data-chat-fold-hidden'), 'true');
  app.document.querySelector('[data-message-id="a"]').closest('article').outerHTML = answer('a', 'Rebuilt');
  await sleep(110);
  assert.equal(app.controls().length, 2);
  assert.equal(app.document.querySelector('[data-message-id="a"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
});

test('bulk actions and disabling restore every original answer without changing text', async t => {
  const app = await setup(t, user + answer('a') + answer('b'));
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 2);
  app.message({ type: 'chat-fold:set-all', collapsed: false });
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 0);
  app.message({ type: 'chat-fold:set-all', collapsed: true });
  app.change({ enabled: { newValue: false } });
  assert.equal(app.controls().length, 0);
  assert.equal(app.document.querySelectorAll('[data-chat-fold-hidden]').length, 0);
  assert.equal(app.document.querySelectorAll('[data-message-author-role="assistant"]').length, 2);
  app.change({ enabled: { newValue: true } });
  assert.equal(app.controls().length, 2);
});

test('SPA navigation resets state and removes orphan controls', async t => {
  const app = await setup(t);
  app.controls()[0].shadowRoot.querySelector('button').click();
  app.window.history.pushState({}, '', '/c/second');
  app.document.querySelector('main').innerHTML = user + answer('a');
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 1);
  app.document.querySelector('[data-message-id="a"]').closest('article').remove();
  await sleep(110);
  assert.equal(app.controls().length, 0);
});

test('supports current data-turn markup without touching user turns', async t => {
  const app = await setup(t, '<article data-turn="user">Question</article><article data-turn="assistant"><div data-message-author-role="assistant" data-message-id="x">Answer</div></article>');
  assert.equal(app.controls().length, 1);
  assert.equal(app.document.querySelector('[data-turn="assistant"]').getAttribute('data-chat-fold-hidden'), 'true');
  assert.equal(app.document.querySelector('[data-turn="user"]').hasAttribute('data-chat-fold-hidden'), false);
});

test('fallback never hides a user in a shared container', async t => {
  const app = await setup(t, '<article data-testid="conversation-turn-shared"><div data-message-author-role="user">Question</div><div data-message-author-role="assistant">Answer</div></article>');
  assert.equal(app.document.querySelector('article').hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(app.document.querySelector('[data-message-author-role="assistant"]').getAttribute('data-chat-fold-hidden'), 'true');
});

test('default-expanded preference applies only to new answers', async t => {
  const app = await setup(t);
  app.change({ defaultCollapsed: { newValue: false } });
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 1);
  app.document.querySelector('main').insertAdjacentHTML('beforeend', answer('b'));
  await sleep(110);
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 1);
  assert.equal(app.message({ type: 'chat-fold:status' }).total, 2);
});

test('manifest references real files and requests no unnecessary permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json')));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
  for (const entry of manifest.content_scripts) {
    for (const file of [...entry.js, ...entry.css]) assert.ok(fs.existsSync(path.join(__dirname, '..', file)));
  }
  assert.ok(fs.existsSync(path.join(__dirname, '..', manifest.action.default_popup)));
});

test('detects role-free ChatGPT turns by accessible speaker headings', async t => {
  const app = await setup(t, `<article data-testid="conversation-turn-1"><h5 class="sr-only">You said:</h5><div class="markdown">User formatted question</div></article>
    <article data-testid="conversation-turn-2"><h6 class="sr-only">ChatGPT said:</h6><div>Answer without role markers</div></article>`);
  assert.equal(app.controls().length, 1);
  assert.equal(app.document.querySelector('[data-testid="conversation-turn-1"]').hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(app.document.querySelector('[data-testid="conversation-turn-2"]').getAttribute('data-chat-fold-hidden'), 'true');
});

test('detects Markdown-only turns and agent-turn containers without role attributes', async t => {
  const app = await setup(t, `<article data-testid="conversation-turn-1"><div data-testid="user-message">Question</div></article>
    <article data-testid="conversation-turn-2"><div class="markdown prose">First answer</div></article>
    <section class="agent-turn">Second answer</section>
    <div id="composer"><div class="markdown">Draft input</div></div>`);
  assert.equal(app.controls().length, 2);
  assert.equal(app.document.querySelector('#composer').querySelector('[data-chat-fold-hidden]'), null);
  assert.equal(app.document.querySelector('[data-testid="conversation-turn-1"]').hasAttribute('data-chat-fold-hidden'), false);
});

test('recognizes late-added fallback classes after page hydration', async t => {
  const app = await setup(t, '<article><div id="hydrating">Answer</div></article>');
  assert.equal(app.controls().length, 0);
  app.document.querySelector('#hydrating').className = 'markdown';
  await sleep(110);
  assert.equal(app.controls().length, 1);
});

test('deduplicates nested role, heading and Markdown matches and keeps document order', async t => {
  const app = await setup(t, `<article data-testid="conversation-turn-1"><h6>ChatGPT said:</h6><section class="agent-turn"><div data-role="assistant"><div class="markdown">First answer</div></div></section></article>
    <article data-testid="conversation-turn-2"><div data-message-author-role="assistant">Second answer</div></article>`);
  assert.equal(app.controls().length, 2);
  assert.equal(app.controls()[0].nextSibling.getAttribute('data-testid'), 'conversation-turn-1');
  assert.equal(app.controls()[1].nextSibling.getAttribute('data-testid'), 'conversation-turn-2');
});

test('diagnostics return structure counts without chat text or message identifiers', async t => {
  const app = await setup(t, user + answer('private-id', 'Private medical answer'));
  const result = app.message({ type: 'chat-fold:diagnose' });
  assert.equal(result.version, '1.0.5');
  assert.equal(result.structure.detectedAnswers, 1);
  assert.equal(result.structure.roleCounts['data-message-author-role'].assistant, 1);
  assert.doesNotMatch(JSON.stringify(result), /Private medical|private-id|My question|\/c\/first/);
});

test('creates working buttons even when Trusted Types rejects HTML string injection', async t => {
  const app = await setup(t, user + answer('a'), {}, true);
  assert.equal(app.controls().length, 1);
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).error, null);
  app.controls()[0].shadowRoot.querySelector('button').click();
  assert.equal(app.document.querySelector('[data-message-id="a"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
});

test('reinjection tears down the previous engine and does not duplicate buttons', async t => {
  const app = await setup(t);
  const old = app.window.__chatFoldRuntime;
  for (const file of ['build/content/dom.js', 'build/content/registry.js', 'build/content/adapters/chatgpt.js', 'build/content/engine.js']) {
    app.window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  }
  await sleep(10);
  assert.notEqual(app.window.__chatFoldRuntime, old);
  assert.equal(app.controls().length, 1);
  app.change({ enabled: { newValue: false } });
  assert.equal(app.controls().length, 0);
});

test('versioned status reports render failures instead of dropping the message response', async t => {
  const app = await setup(t);
  app.window.ChatFold.resolve(app.window.location).findAnswers = () => { throw new TypeError('private text'); };
  const result = app.message({ type: 'chat-fold:v2:status' });
  assert.equal(result.protocol, 2);
  assert.equal(result.error.stage, 'render');
  assert.equal(result.error.name, 'TypeError');
  assert.doesNotMatch(JSON.stringify(result), /private text/);
  const diagnostic = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(diagnostic.engineError.name, 'TypeError');
  assert.equal(diagnostic.structure.controls, 1);
});

test('finds and folds answers when the top document has zero articles and three shadow roots', async t => {
  const app = await setup(t, '<div id="app"></div><div id="utility"></div><div id="overlay"></div><iframe></iframe>');
  const chat = app.document.querySelector('#app').attachShadow({ mode: 'open' });
  app.document.querySelector('#utility').attachShadow({ mode: 'open' });
  app.document.querySelector('#overlay').attachShadow({ mode: 'open' });
  chat.innerHTML = user + answer('nested');
  const status = app.message({ type: 'chat-fold:v2:status' });
  assert.equal(app.document.querySelectorAll('article').length, 0);
  assert.equal(status.total, 1);
  const control = chat.querySelector('[data-chat-fold-control]');
  assert.ok(control);
  assert.match(chat.querySelector('[data-chat-fold-style]').textContent, /display:none!important/);
  assert.equal(chat.querySelector('[data-message-id="nested"]').closest('article').getAttribute('data-chat-fold-hidden'), 'true');
  control.shadowRoot.querySelector('button').click();
  assert.equal(chat.querySelector('[data-message-id="nested"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
  assert.equal(chat.querySelector('[data-message-author-role="user"]').closest('article').hasAttribute('data-chat-fold-hidden'), false);
  // ShadowRoot uses a template fragment for streamed turns.
  const template = app.document.createElement('template');
  template.innerHTML = answer('streamed');
  chat.append(template.content);
  await sleep(110);
  assert.equal(chat.querySelectorAll('[data-chat-fold-control]').length, 2);
  const diagnostic = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(diagnostic.structure.articles, 0);
  assert.equal(diagnostic.nested.contexts.filter(context => context.kind === 'shadow').length, 3);
  assert.equal(diagnostic.nested.contexts.find(context => context.kind === 'shadow' && context.articles).articles, 3);
  app.change({ enabled: { newValue: false } });
  assert.equal(chat.querySelectorAll('[data-chat-fold-hidden]').length, 0);
  assert.equal(chat.querySelectorAll('[data-chat-fold-control]').length, 0);
});

test('walks nested shadow roots, protects user-hosted shadow content and deduplicates answer-hosted shadows', async t => {
  const app = await setup(t, '<div id="root"></div>');
  const first = app.document.querySelector('#root').attachShadow({ mode: 'open' });
  first.innerHTML = '<section id="inner"></section><article data-turn="user" id="question"></article><article data-turn="assistant" id="answer"></article>';
  const inner = first.querySelector('#inner').attachShadow({ mode: 'open' });
  inner.innerHTML = answer('a');
  first.querySelector('#question').attachShadow({ mode: 'open' }).innerHTML = '<article><div class="markdown">User input</div></article>';
  first.querySelector('#answer').attachShadow({ mode: 'open' }).innerHTML = answer('b');
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 2);
  assert.equal(first.querySelector('#question').shadowRoot.querySelector('[data-chat-fold-hidden]'), null);
  assert.equal(first.querySelector('#answer').shadowRoot.querySelector('[data-chat-fold-control]'), null);
  assert.equal(first.querySelector('#answer').getAttribute('data-chat-fold-hidden'), 'true');
});

test('finds frame answers and later streams, including shadows inside a same-origin iframe', async t => {
  const app = await setup(t, '<iframe id="frame"></iframe>');
  const frameDocument = app.document.querySelector('#frame').contentDocument;
  frameDocument.body.innerHTML = user + answer('a') + '<div id="nested"></div>';
  const shadow = frameDocument.querySelector('#nested').attachShadow({ mode: 'open' });
  shadow.innerHTML = answer('b');
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 2);
  assert.equal(frameDocument.querySelectorAll('[data-chat-fold-control]').length, 1);
  assert.ok(frameDocument.head.querySelector('[data-chat-fold-style]'));
  assert.ok(shadow.querySelector('[data-chat-fold-style]'));
  frameDocument.body.insertAdjacentHTML('beforeend', answer('c'));
  await sleep(110);
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 3);
  app.document.querySelector('#frame').remove();
  await sleep(110);
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 0);
  assert.equal(frameDocument.querySelectorAll('[data-chat-fold-hidden]').length, 0);
});

test('Chrome closed-shadow API discovers closed roots without changing page attachShadow', async t => {
  const app = await setup(t, '<div id="closed"></div>');
  const host = app.document.querySelector('#closed');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = user + answer('closed');
  app.window.chrome.dom = { openOrClosedShadowRoot: node => node === host ? root : null };
  assert.equal(host.shadowRoot, null);
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 1);
  assert.ok(root.querySelector('[data-chat-fold-control]'));
  const diagnostic = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(diagnostic.nested.closedShadowRoots, 1);
});

test('polling discovers attachShadow on an existing host with no parent DOM mutation', async t => {
  const app = await setup(t, '<div id="late"></div>');
  const root = app.document.querySelector('#late').attachShadow({ mode: 'open' });
  root.innerHTML = answer('late');
  await sleep(950);
  assert.ok(root.querySelector('[data-chat-fold-control]'));
});

test('inaccessible frames are reported without throwing or requesting broad permissions', async t => {
  const app = await setup(t, '<iframe id="cross"></iframe>');
  Object.defineProperty(app.document.querySelector('#cross'), 'contentDocument', { get: () => null });
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).error, null);
  const diagnostic = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(diagnostic.nested.inaccessibleFrames, 1);
});

test('SVG and MathML elements are never passed to the HTMLElement-only Chrome shadow API', async t => {
  const app = await setup(t, '<svg><path d="M0 0L1 1"></path></svg><math><mi>x</mi></math><div id="closed"></div>');
  const host = app.document.querySelector('#closed');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = user + answer('a');
  let invalidCalls = 0;
  app.window.chrome.dom = { openOrClosedShadowRoot(element) {
    if (!(element instanceof element.ownerDocument.defaultView.HTMLElement)) {
      invalidCalls++;
      throw new TypeError('No matching signature');
    }
    return element === host ? root : null;
  } };
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 1);
  assert.equal(invalidCalls, 0);
  const result = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(result.nested.closedShadowRoots, 1);
});

test('one rejected Chrome shadow lookup cannot abort detection or independent diagnostics', async t => {
  const app = await setup(t, '<div id="restricted"></div><div id="chat"></div>');
  const chat = app.document.querySelector('#chat').attachShadow({ mode: 'open' });
  chat.innerHTML = user + answer('a');
  app.window.chrome.dom = { openOrClosedShadowRoot(element) {
    if (element.id === 'restricted') throw new TypeError('private conversation data');
    return null;
  } };
  const status = app.message({ type: 'chat-fold:v2:status' });
  assert.equal(status.error, null);
  assert.equal(status.total, 1);
  const result = app.window.eval(fs.readFileSync(path.join(__dirname, '../build/content/probe.js'), 'utf8') + '\nChatFoldProbe()');
  assert.equal(result.nested.scanErrors[0].type, 'shadow-access/TypeError');
  assert.equal(result.nested.scanErrors[0].count, 1);
  assert.doesNotMatch(JSON.stringify(result), /private conversation data/);
});

const modernFixture = fs.readFileSync(path.join(__dirname, 'fixtures/chatgpt-modern.html'), 'utf8');

test('real modern ChatGPT structure folds answer, reasoning and actions while retaining user content', async t => {
  const app = await setup(t, modernFixture);
  assert.equal(app.document.querySelectorAll('article, [data-message-author-role], .markdown').length, 0);
  assert.equal(app.message({ type: 'chat-fold:v2:status' }).total, 1);
  for (const id of ['reasoning', 'answer-block', 'assistant-actions', 'answer-footer']) {
    assert.equal(app.document.getElementById(id).getAttribute('data-chat-fold-hidden'), 'true', id);
  }
  for (const id of ['user-block', 'user-actions']) {
    assert.equal(app.document.getElementById(id).closest('[data-chat-fold-hidden]'), null, id);
  }
  app.controls()[0].shadowRoot.querySelector('button').click();
  assert.equal(app.document.querySelectorAll('[data-chat-fold-hidden]').length, 0);
  app.message({ type: 'chat-fold:set-all', collapsed: true });
  app.change({ enabled: { newValue: false } });
  assert.equal(app.document.querySelectorAll('[data-chat-fold-hidden]').length, 0);
  assert.equal(app.controls().length, 0);
});

test('modern streamed blocks keep expansion state and all answer segments join the same control', async t => {
  const app = await setup(t, modernFixture);
  app.controls()[0].shadowRoot.querySelector('button').click();
  app.document.getElementById('answer-block').insertAdjacentHTML('beforebegin', '<div id="streamed">Streamed reasoning block</div>');
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(app.document.getElementById('streamed').hasAttribute('data-chat-fold-hidden'), false);
  app.controls()[0].shadowRoot.querySelector('button').click();
  assert.equal(app.document.getElementById('streamed').getAttribute('data-chat-fold-hidden'), 'true');
  app.document.getElementById('reasoning').remove();
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(app.message({ type: 'chat-fold:status' }).collapsed, 1);
});

test('modern page cache excludes inactive conversations and reacts to active-page changes', async t => {
  const app = await setup(t, modernFixture);
  const active = app.document.querySelector('[data-app-shell-active-page]');
  const cached = active.cloneNode(true);
  // Simulate a fresh cached page rather than copying extension controls or hidden attributes.
  cached.querySelectorAll('[data-chat-fold-control]').forEach(node => node.remove());
  cached.querySelectorAll('[data-chat-fold-hidden]').forEach(node => node.removeAttribute('data-chat-fold-hidden'));
  cached.setAttribute('data-app-shell-active-page', 'false');
  app.document.querySelector('main').append(cached);
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(cached.querySelector('[data-chat-fold-hidden]'), null);
  active.setAttribute('data-app-shell-active-page', 'false');
  cached.setAttribute('data-app-shell-active-page', 'true');
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(active.querySelector('[data-chat-fold-hidden]'), null);
  assert.ok(cached.querySelector('[data-chat-fold-hidden]'));
});

test('modern user-only turns are left alone until an assistant turn begins', async t => {
  const app = await setup(t, '<div data-turn-key="pending"><div data-talvt-turn-state="pending"><div id="user"><h4 data-conversation-role="user">You</h4><div data-user-message-bubble>Pending question</div></div></div></div>');
  assert.equal(app.controls().length, 0);
  app.document.querySelector('[data-talvt-turn-state]').insertAdjacentHTML('beforeend', '<div data-chatgpt-agent-turn-start>Thinking</div>');
  await sleep(110);
  assert.equal(app.controls().length, 1);
  assert.equal(app.document.getElementById('user').closest('[data-chat-fold-hidden]'), null);
});
