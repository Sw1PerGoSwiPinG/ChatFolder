(() => {
  'use strict';
  const PREFIX = 'chatfolder:state:v1:';
  const accepted = (key: string) => key.startsWith(PREFIX) || key.startsWith('chatfolder:index:v1:') || key.startsWith('chatfolder:catalog:v1:');
  function create(provider: string): FoldHistory {
    const values = new Map<string, unknown>();
    const pending = new Map<string, unknown>();
    const dirty = new Set<string>();
    let writing = false;
    let loaded = false;
    async function flush(): Promise<void> {
      if (writing || !pending.size) return;
      writing = true;
      try {
        while (pending.size) {
          const batch = Object.fromEntries(pending);
          pending.clear();
          try { await chrome.storage.local.set(batch); }
          catch { /* Keep memory state when storage is unavailable or full. */ }
          for (const key of Object.keys(batch)) if (!pending.has(key)) dirty.delete(key);
        }
      } finally { writing = false; }
    }
    return {
      async load() {
        try {
          const stored = await chrome.storage.local.get(null);
          loaded = true;
          for (const [key, value] of Object.entries(stored)) {
            if (accepted(key) && !dirty.has(key)) values.set(key, value);
          }
        } catch { /* Folding remains available without storage. */ }
      },
      key(kind, message) {
        const conversation = location.pathname.match(/\/c\/([^/]+)/)?.[1];
        if (!message) return null;
        if (!conversation) return 'chatfolder:volatile:' + JSON.stringify([provider, location.pathname, kind, message]);
        // One storage entry per message avoids overwriting another tab's messages.
        // IDs and booleans only: no message bodies, titles or query parameters.
        return PREFIX + JSON.stringify([provider, conversation, kind, message]);
      },
      get(key) { const value = key ? values.get(key) : undefined; return typeof value === 'boolean' ? value : undefined; },
      entries() { return [...values.entries()]; },
      read(key) { return values.get(key); },
      write(key, value) {
        if (JSON.stringify(values.get(key)) === JSON.stringify(value)) return;
        values.set(key, value);
        if (!loaded) return;
        pending.set(key, value); dirty.add(key); void flush();
      },
      set(key, collapsed) {
        if (!key || values.get(key) === collapsed) return;
        values.set(key, collapsed);
        if (key.startsWith('chatfolder:volatile:')) return;
        pending.set(key, collapsed);
        dirty.add(key);
        void flush();
      },
      remember(key, collapsed) {
        // A failed read must not replace unknown saved choices with defaults.
        if (loaded) this.set(key, collapsed);
      },
      update(changes) {
        let changed = false;
        for (const [key, change] of Object.entries(changes)) {
          if (!accepted(key) || dirty.has(key)) continue;
          if (change.newValue !== undefined) values.set(key, change.newValue);
          else values.delete(key);
          changed = true;
        }
        return changed;
      }
    };
  }
  globalThis.ChatFoldHistory = { create };
})();
