(() => {
  "use strict";
  globalThis.__chatFoldRuntime?.destroy();
  const resolvedAdapter = ChatFold.resolve(location);
  if (!resolvedAdapter) return;
  const adapter: ProviderAdapter = resolvedAdapter;

  let settings = { ...ChatFold.defaults };
  let route = location.pathname;
  let timer: number | undefined;
  let sequence = 0;
  const records = new Map<Element, AnswerRecord>();
  const choices = new Map<string, boolean>();
  const CONTROLS = "[data-chat-fold-control]";
  const DOM = ChatFoldDOM;
  const scopes = new Map<DOMScope, HTMLStyleElement>();
  const scopeIds = new WeakMap<Node, number>();
  let nextScopeId = 0;
  const observationOptions = { subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-message-author-role', 'data-turn', 'data-message-id', 'data-testid',
      'data-author-role', 'data-message-role', 'data-role', 'aria-label', 'class', 'src',
      'data-conversation-role', 'data-turn-key', 'data-talvt-turn-state',
      'data-chatgpt-agent-turn-start', 'data-app-shell-active-page'] };
  const scopeCSS = '[data-chat-fold-hidden="true"]{display:none!important}' +
    '[data-chat-fold-control]{display:block!important;width:100%;box-sizing:border-box}';
  let interval: number | undefined;
  let destroyed = false;
  let failure: EngineFailure | null = null;
  const runtime: FoldRuntime = globalThis.__chatFoldRuntime = {
    protocol: 2,
    version: chrome.runtime.getManifest().version,
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

  function createControl(state: AnswerState): AnswerRecord {
    const host = document.createElement("div");
    host.setAttribute("data-chat-fold-control", "");
    const shadow = host.attachShadow({ mode: "open" });
    // Avoid innerHTML: host pages can enforce Trusted Types for DOM HTML sinks.
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; color:inherit; }
      .wrap { max-width:var(--thread-content-max-width,768px); margin:0 auto; padding:6px 0 12px; box-sizing:border-box; }
      button { display:flex; align-items:center; gap:8px; padding:6px 10px;
        border:1px solid color-mix(in srgb,currentColor 20%,transparent); border-radius:6px;
        background:transparent; color:inherit; cursor:pointer;
        font:12px/1.5 "Segoe UI Variable Text","Segoe UI","Microsoft YaHei",sans-serif; }
      button:hover { background:color-mix(in srgb,currentColor 6%,transparent); }
      button:focus-visible { outline:2px solid #4b83f5; outline-offset:3px; }
      .icon { font-size:15px; line-height:1; transition:transform .15s; }
      button[aria-expanded="true"] .icon { transform:rotate(90deg); }
      .number { font-size:10px; font-variant-numeric:tabular-nums; opacity:.5; }
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
    const record: AnswerRecord = { ...state, host, button,
      label: shadow.querySelector<HTMLSpanElement>('.label')!,
      number: shadow.querySelector<HTMLSpanElement>('.number')! };
    record.button.addEventListener("click", () => {
      record.collapsed = !record.collapsed;
      choices.set(record.key, record.collapsed);
      paint(record);
    });
    return record;
  }

  function paint(record: AnswerRecord): void {
    for (const element of record.targets) {
      if (record.collapsed) element.setAttribute('data-chat-fold-hidden', 'true');
      else element.removeAttribute('data-chat-fold-hidden');
    }
    record.button.setAttribute("aria-expanded", String(!record.collapsed));
    record.label.textContent = record.collapsed ? "展开回答" : "收起回答";
    record.number.textContent = String(record.index).padStart(2, "0");
    record.button.setAttribute("aria-label", `${record.collapsed ? "展开" : "收起"}第 ${record.index} 次 AI 回答`);
  }

  function restore(record: AnswerRecord): void {
    for (const element of record.targets) element.removeAttribute('data-chat-fold-hidden');
    record.host.remove();
  }

  function syncScopes(discovery: DOMDiscovery): void {
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
        const owner = root.nodeType === 9 ? root as Document : root.ownerDocument!;
        const style = owner.createElement('style');
        style.setAttribute('data-chat-fold-style', '');
        style.textContent = scopeCSS;
        (root.nodeType === 9 ? (root as Document).head || root : root).append(style);
        root.addEventListener('load', schedule, true);
        scopes.set(root, style);
        changed = true;
      } else if (!scopes.get(root)!.isConnected) {
        (root.nodeType === 9 ? (root as Document).head || root : root).append(scopes.get(root)!);
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
        record = undefined;
      }
      if (!record) {
        const key = stableKey || `${route}:anonymous-${++sequence}`;
        record = createControl({ element: answer.element, targets: new Set(), key, index: index + 1, collapsed: choices.get(key) ?? settings.defaultCollapsed });
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
    catch (error) { failure = { stage: 'render', name: DOM.errorName(error) }; }
  }

  // Ignore our own DOM insertions. Character changes during streaming need no scan.
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => {
      if (mutation.target.nodeType === 1 && (mutation.target as Element).closest(`${CONTROLS}, [data-chat-fold-style]`)) return false;
      if (mutation.type === "attributes") return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node.nodeType === 1 && !(node as Element).matches(`${CONTROLS}, [data-chat-fold-style]`));
    })) schedule();
  });

  function onMessage(message: unknown, _sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) {
    // Versioned names prevent an old content script from winning the response race.
    if (!message || typeof message !== 'object' || !('type' in message) || typeof message.type !== 'string') return;
    const request = message as { type: string; collapsed?: unknown };
    const type = request.type.replace('chat-fold:v2:', 'chat-fold:');
    try {
    if (type === "chat-fold:diagnose") {
      respond({ version: runtime.version, protocol: runtime.protocol, provider: adapter.id,
        enabled: settings.enabled, structure: adapter.diagnose?.(document) ?? null });
    } else if (type === "chat-fold:status") {
      safeReconcile();
      respond({ version: runtime.version, protocol: runtime.protocol, error: failure,
        provider: adapter.label, enabled: settings.enabled, total: records.size,
        collapsed: [...records.values()].filter(record => record.collapsed).length });
    } else if (type === "chat-fold:set-all" && typeof request.collapsed === "boolean") {
      reconcile();
      for (const record of records.values()) {
        record.collapsed = request.collapsed;
        choices.set(record.key, record.collapsed);
        paint(record);
      }
      respond({ ok: true });
    }
    } catch (error) {
      respond({ protocol: 2, version: runtime.version, error: { stage: 'message', name: DOM.errorName(error) } });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  function onStorageChange(changes: Record<string, chrome.storage.StorageChange>, area: string) {
    if (area !== "local") return;
    for (const name of (Object.keys(ChatFold.defaults) as (keyof FoldSettings)[])) {
      if (changes[name]) {
        const value: unknown = changes[name].newValue;
        settings[name] = typeof value === 'boolean' ? value : ChatFold.defaults[name];
      }
    }
    safeReconcile();
  }
  chrome.storage.onChanged.addListener(onStorageChange);

  async function start() {
    try { settings = { ...settings, ...await chrome.storage.local.get(ChatFold.defaults) as Partial<FoldSettings> }; }
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
  start().catch(error => { failure = { stage: 'startup', name: DOM.errorName(error) }; });
})();
