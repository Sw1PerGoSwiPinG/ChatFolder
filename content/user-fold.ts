(() => {
  'use strict';
  const COLLAPSED = 'data-chat-fold-user-collapsed';
  const LINES = '--chatfolder-user-lines';
  const WIDTH = '--chatfolder-user-width';
  interface UserRecord {
    element: HTMLElement; key: string; width: number; eligible: boolean; collapsed: boolean;
    parent: HTMLElement | null; parentWidth: number;
    host: HTMLDivElement; button: HTMLButtonElement;
    originalStyles: Map<string, { value: string; priority: string }>;
    lastStyle: string | null;
  }
  const css = `[${COLLAPSED}]{display:-webkit-box!important;-webkit-box-orient:vertical!important;
    -webkit-line-clamp:var(${LINES})!important;overflow:clip!important;overflow-clip-margin:content-box!important;
    width:var(${WIDTH})!important;box-sizing:border-box!important}`;
  function create(adapter: ProviderAdapter, document: Document, schedule: () => void): UserFoldController {
    const records = new Map<HTMLElement, UserRecord>();
    const choices = new Map<string, boolean>();
    const scopeIds = new WeakMap<Node, number>();
    const fontSets = new Set<FontFaceSet>();
    let sequence = 0, scopeSequence = 0;
    let settings = { ...ChatFold.defaults };
    let destroyed = false;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
      if (entries.some(entry => {
        const width = entry.target.getBoundingClientRect().width;
        return [...records.values()].some(record =>
          (entry.target === record.element && Math.abs(width - record.width) > 0.5) ||
          (entry.target === record.parent && Math.abs(width - record.parentWidth) > 0.5));
      })) schedule();
    }) : null;
    function restoreStyles(record: UserRecord): void {
      record.element.removeAttribute(COLLAPSED);
      for (const [name, original] of record.originalStyles) {
        if (original.value) record.element.style.setProperty(name, original.value, original.priority);
        else record.element.style.removeProperty(name);
      }
    }
    function paint(record: UserRecord): void {
      record.element.toggleAttribute(COLLAPSED, record.eligible && record.collapsed);
      record.button.setAttribute('aria-expanded', String(!record.collapsed));
      record.button.textContent = record.collapsed ? '···' : '收起';
      record.button.setAttribute('aria-label', record.collapsed ? '展开完整用户输入' : `收起用户输入，仅显示 ${settings.userLines} 行`);
      record.button.title = record.collapsed ? '显示完整输入' : `仅显示前 ${settings.userLines} 行`;
    }
    function add(element: HTMLElement, key: string): UserRecord {
      const owner = element.ownerDocument;
      const host = owner.createElement('div');
      host.setAttribute('data-chat-fold-control', 'user');
      host.setAttribute('data-chat-fold-user-control', '');
      host.style.cssText = 'max-width:100%;align-self:flex-end;flex-shrink:0;margin-inline-start:auto;margin-top:4px;';
      const shadow = host.attachShadow({ mode: 'open' });
      const style = owner.createElement('style');
      style.textContent = `:host{display:block;color:inherit}button{display:flex;align-items:center;justify-content:center;
        width:100%;min-height:24px;box-sizing:border-box;border:1px solid color-mix(in srgb,currentColor 18%,transparent);
        border-radius:6px;background:transparent;color:inherit;font:11px/1.4 "Segoe UI","Microsoft YaHei",sans-serif;
        padding:3px 8px;min-width:0;white-space:nowrap;cursor:pointer;opacity:.8}button:hover{opacity:1;background:color-mix(in srgb,currentColor 6%,transparent)}
        button:focus-visible{outline:2px solid #4b83f5;outline-offset:2px}`;
      const button = owner.createElement('button'); button.type = 'button';
      shadow.append(style, button);
      const record: UserRecord = { element, key, host, button, width: 0, eligible: false, collapsed: choices.get(key) ?? true, lastStyle: null,
        parent: element.parentElement, parentWidth: 0,
        originalStyles: new Map([LINES, WIDTH].map(name => [name, { value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }])) };
      button.addEventListener('click', () => { record.collapsed = !record.collapsed; choices.set(record.key, record.collapsed); paint(record); });
      resize?.observe(element);
      if (record.parent) resize?.observe(record.parent);
      return record;
    }
    function measure(record: UserRecord): void {
      const { element } = record;
      if (record.parent !== element.parentElement) {
        unobserveParent(record);
        record.parent = element.parentElement;
        if (record.parent) resize?.observe(record.parent);
      }
      record.parentWidth = record.parent?.getBoundingClientRect().width || 0;
      // Compare actual full and line-clamped layouts, including soft wraps,
      // explicit newlines, inline markup, font metrics and bubble padding.
      element.removeAttribute(COLLAPSED);
      const full = element.getBoundingClientRect(); record.width = full.width;
      element.style.setProperty(LINES, String(settings.userLines));
      element.style.setProperty(WIDTH, `${full.width}px`);
      element.setAttribute(COLLAPSED, '');
      record.eligible = full.width > 0 && full.height - element.getBoundingClientRect().height > 0.5;
      if (!record.eligible) { restoreStyles(record); record.host.remove(); record.lastStyle = element.getAttribute('style'); return; }
      // Override the shared control's width:100% with the bubble border box.
      record.host.style.setProperty('width', `${full.width}px`, 'important');
      if (element.nextSibling !== record.host) element.after(record.host);
      paint(record);
      record.lastStyle = element.getAttribute('style');
    }
    function unobserveParent(record: UserRecord): void {
      if (record.parent && ![...records.values()].some(other => other !== record && other.parent === record.parent)) resize?.unobserve(record.parent);
    }
    function remove(record: UserRecord): void { resize?.unobserve(record.element); unobserveParent(record); restoreStyles(record); record.host.remove(); }
    function reset(): void { for (const record of records.values()) remove(record); records.clear(); choices.clear(); }
    return {
      reconcile(nextSettings, discovery) {
        settings = nextSettings;
        if (!settings.userEnabled) { for (const record of records.values()) remove(record); records.clear(); return; }
        const messages = adapter.findUserMessages?.(document, discovery) || [];
        const live = new Set(messages.map(message => message.element));
        for (const [element, record] of records) if (!live.has(element)) { remove(record); records.delete(element); }
        for (const message of messages) {
          const scope = message.element.getRootNode();
          if (!scopeIds.has(scope)) scopeIds.set(scope, ++scopeSequence);
          let record = records.get(message.element);
          const stableKey = message.key ? `${scopeIds.get(scope)}:${message.key}` : null;
          if (record && stableKey && record.key !== stableKey) { remove(record); records.delete(message.element); record = undefined; }
          if (!record) { record = add(message.element, stableKey || `anonymous-${++sequence}`); records.set(message.element, record); }
          measure(record);
          const fonts = message.element.ownerDocument.fonts;
          if (fonts && !fontSets.has(fonts)) {
            fontSets.add(fonts); fonts.addEventListener('loadingdone', schedule);
            void fonts.ready.then(() => { if (!destroyed) schedule(); });
          }
        }
      },
      status() {
        const eligible = [...records.values()].filter(record => record.eligible);
        return { enabled: settings.userEnabled, lines: settings.userLines, total: eligible.length, collapsed: eligible.filter(record => record.collapsed).length };
      },
      setAll(collapsed) { for (const record of records.values()) if (record.eligible) { record.collapsed = collapsed; choices.set(record.key, collapsed); paint(record); } },
      contains(node) { return [...records.values()].some(record => record.element.contains(node)); },
      ignoreMutation(mutation) {
        const record = records.get(mutation.target as HTMLElement);
        return Boolean(record && mutation.type === 'attributes' && mutation.attributeName === 'style' && record.lastStyle === record.element.getAttribute('style'));
      },
      reset,
      destroy() { destroyed = true; reset(); resize?.disconnect(); for (const fonts of fontSets) fonts.removeEventListener('loadingdone', schedule); fontSets.clear(); }
    };
  }
  globalThis.ChatFoldUsers = { css, create };
})();
