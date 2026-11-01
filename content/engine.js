(() => {
  "use strict";
  globalThis.__chatFoldRuntime?.destroy();
  const adapter = ChatFold.resolve(location);
  if (!adapter) return;

  let settings = { ...ChatFold.defaults };
  let route = location.pathname;
  let timer;
  let sequence = 0;
  const records = new Map();
  const choices = new Map();
  const CONTROLS = "[data-chat-fold-control]";
  const DOM = ChatFoldDOM;
  const scopes = new Map();
  const scopeIds = new WeakMap();
  let nextScopeId = 0;
  const observationOptions = { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-message-author-role', 'data-turn', 'data-message-id', 'data-testid',
      'data-author-role', 'data-message-role', 'data-role', 'aria-label', 'class', 'src',
      'data-conversation-role', 'data-turn-key', 'data-talvt-turn-state',
      'data-chatgpt-agent-turn-start', 'data-app-shell-active-page'] };
  const scopeCSS = '[data-chat-fold-hidden="true"]{display:none!important}' +
    '[data-chat-fold-control]{display:block!important;width:100%;box-sizing:border-box}';
  let interval;
  let destroyed = false;
  let failure = null;
  const runtime = globalThis.__chatFoldRuntime = {
    protocol: 2,
    version: '1.0.5',
    get error() { return failure; },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      clearInterval(interval);
      observer.disconnect();
      for (const [root, style] of scopes) {
        root.removeEventListener('load', schedule, true);
        style.remove();
      }
      scopes.clear();
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorageChange);
      removeEventListener('popstate', schedule);
      removeEventListener('pageshow', schedule);
      for (const record of records.values()) restore(record);
      records.clear();
    }
  };

  function createControl(record) {
    const host = document.createElement("div");
    host.setAttribute("data-chat-fold-control", "");
    const shadow = host.attachShadow({ mode: "open" });
    // Avoid innerHTML: host pages can enforce Trusted Types for DOM HTML sinks.
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; color-scheme:light dark; }
      .wrap { max-width:768px; margin:0 auto; padding:9px 24px 19px; box-sizing:border-box; }
      button { display:flex; align-items:center; gap:10px; padding:9px 13px; border:1px solid #d8e1dc;
        border-radius:9px; background:#f3f6f3; color:#355847; cursor:pointer; font:13px/1.5 ui-sans-serif,system-ui,sans-serif; }
      button:hover { background:#e8eee9; border-color:#96b1a0; }
      button:focus-visible { outline:2px solid #39835d; outline-offset:3px; }
      .icon { font-size:16px; line-height:1; transition:transform .15s; }
      button[aria-expanded="true"] .icon { transform:rotate(90deg); }
      .number { font:11px ui-monospace,monospace; opacity:.6; padding-left:8px; border-left:1px solid #aebfb3; }
      @media(prefers-color-scheme:dark) {
        button { background:#242e28; border-color:#3b4c40; color:#c3dacb; }
        button:hover { background:#303e34; border-color:#729980; }
      }
      @media(prefers-reduced-motion:reduce) { .icon { transition:none; } }
    `;
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const button = document.createElement('button');
    button.type = 'button';
    for (const name of ['icon', 'label', 'number']) {
      const span = document.createElement('span');
      span.className = name;
      if (name === 'icon') { span.textContent = '›'; span.setAttribute('aria-hidden', 'true'); }
      button.append(span);
    }
    wrap.append(button);
    shadow.append(style, wrap);
    record.host = host;
    record.button = shadow.querySelector("button");
    record.label = shadow.querySelector(".label");
    record.number = shadow.querySelector(".number");
    record.button.addEventListener("click", () => {
      record.collapsed = !record.collapsed;
      choices.set(record.key, record.collapsed);
      paint(record);
    });
  }

  function paint(record) {
    for (const element of record.targets) {
      if (record.collapsed) element.setAttribute('data-chat-fold-hidden', 'true');
      else element.removeAttribute('data-chat-fold-hidden');
    }
    record.button.setAttribute("aria-expanded", String(!record.collapsed));
    record.label.textContent = record.collapsed ? "展开回答" : "收起回答";
    record.number.textContent = String(record.index).padStart(2, "0");
    record.button.setAttribute("aria-label", `${record.collapsed ? "展开" : "收起"}第 ${record.index} 次 AI 回答`);
  }

  function restore(record) {
    for (const element of record.targets) element.removeAttribute('data-chat-fold-hidden');
    record.host.remove();
  }

  function syncScopes(discovery) {
    const roots = new Set(discovery.roots.map(scope => scope.root));
    let changed = false;
    for (const [root, style] of scopes) {
      if (!roots.has(root)) {
        root.removeEventListener('load', schedule, true);
        style.remove();
        scopes.delete(root);
        changed = true;
      }
    }
    for (const root of roots) {
      if (!scopes.has(root)) {
        const owner = root.ownerDocument || root;
        const style = owner.createElement('style');
        style.setAttribute('data-chat-fold-style', '');
        style.textContent = scopeCSS;
        (root.head || root).append(style);
        root.addEventListener('load', schedule, true);
        scopes.set(root, style);
        changed = true;
      } else if (!scopes.get(root).isConnected) {
        (root.head || root).append(scopes.get(root));
      }
    }
    if (changed) {
      observer.disconnect();
      for (const root of roots) observer.observe(root, observationOptions);
    }
  }

  function reconcile() {
    clearTimeout(timer);
    timer = undefined;
    if (destroyed) return;
    if (route !== location.pathname) {
      route = location.pathname;
      // Keep only this tab's live conversation state; never store answer text.
      choices.clear();
      for (const record of records.values()) restore(record);
      records.clear();
    }
    if (!settings.enabled) {
      for (const record of records.values()) restore(record);
      records.clear();
      return;
    }
    const discovery = DOM.scan(document);
    syncScopes(discovery);
    const answers = adapter.findAnswers(document, discovery);
    const live = new Set(answers.map(answer => answer.element));
    for (const [element, record] of records) {
      if (!live.has(element)) {
        restore(record);
        records.delete(element);
      }
    }
    answers.forEach((answer, index) => {
      let record = records.get(answer.element);
      const scope = answer.element.getRootNode();
      if (!scopeIds.has(scope)) scopeIds.set(scope, ++nextScopeId);
      const stableKey = answer.key ? `${route}:${scopeIds.get(scope)}:${answer.key}` : null;
      // React can reuse a turn element for a different answer.
      if (record && stableKey && record.key !== stableKey) {
        restore(record);
        records.delete(answer.element);
        record = null;
      }
      if (!record) {
        const key = stableKey || `${route}:anonymous-${++sequence}`;
        record = { element: answer.element, targets: new Set(), key, collapsed: choices.get(key) ?? settings.defaultCollapsed };
        createControl(record);
        records.set(answer.element, record);
      }
      const targets = new Set(answer.elements || [answer.element]);
      for (const oldTarget of record.targets) {
        if (!targets.has(oldTarget)) oldTarget.removeAttribute('data-chat-fold-hidden');
      }
      record.targets = targets;
      record.index = index + 1;
      if (record.host.nextSibling !== answer.element) answer.element.before(record.host);
      paint(record);
    });
  }

  function schedule() {
    // Throttle instead of debounce so continuous streaming cannot postpone folding.
    if (timer !== undefined) return;
    timer = setTimeout(safeReconcile, 60);
  }

  function safeReconcile() {
    try { reconcile(); failure = null; }
    catch (error) { failure = { stage: 'render', name: error?.name || 'Error' }; }
  }

  // Ignore our own DOM insertions. Character changes during streaming need no scan.
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => {
      if (mutation.target.nodeType === 1 && mutation.target.closest(`${CONTROLS}, [data-chat-fold-style]`)) return false;
      if (mutation.type === "attributes") return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node.nodeType === 1 && !node.matches(`${CONTROLS}, [data-chat-fold-style]`));
    })) schedule();
  });

  function onMessage(message, sender, respond) {
    // Versioned names prevent an old content script from winning the response race.
    const type = message?.type?.replace('chat-fold:v2:', 'chat-fold:');
    try {
    if (type === "chat-fold:diagnose") {
      respond({ version: runtime.version, protocol: runtime.protocol, provider: adapter.id,
        enabled: settings.enabled, structure: adapter.diagnose?.(document) ?? null });
    } else if (type === "chat-fold:status") {
      safeReconcile();
      respond({ version: runtime.version, protocol: runtime.protocol, error: failure,
        provider: adapter.label, enabled: settings.enabled, total: records.size,
        collapsed: [...records.values()].filter(record => record.collapsed).length });
    } else if (type === "chat-fold:set-all" && typeof message.collapsed === "boolean") {
      reconcile();
      for (const record of records.values()) {
        record.collapsed = message.collapsed;
        choices.set(record.key, record.collapsed);
        paint(record);
      }
      respond({ ok: true });
    }
    } catch (error) {
      respond({ protocol: 2, version: runtime.version, error: { stage: 'message', name: error?.name || 'Error' } });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function onStorageChange(changes, area) {
    if (area !== "local") return;
    for (const name of Object.keys(ChatFold.defaults)) {
      if (changes[name]) settings[name] = changes[name].newValue ?? ChatFold.defaults[name];
    }
    safeReconcile();
  }
  chrome.storage.onChanged.addListener(onStorageChange);

  async function start() {
    try { settings = { ...settings, ...await chrome.storage.local.get(ChatFold.defaults) }; }
    catch { /* The extension remains useful with defaults if storage is unavailable. */ }
    if (destroyed) return;
    syncScopes(DOM.scan(document));
    safeReconcile();
    // Attaching a shadow root and iframe navigation do not necessarily mutate the parent DOM.
    interval = setInterval(() => {
      const discovery = DOM.scan(document);
      if (route !== location.pathname || discovery.roots.length !== scopes.size ||
        discovery.roots.some(({ root }) => !scopes.has(root))) schedule();
    }, 750);
    addEventListener("popstate", schedule);
    addEventListener("pageshow", schedule);
  }
  start().catch(error => { failure = { stage: 'startup', name: error?.name || 'Error' }; });
})();
