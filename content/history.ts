(() => {
  'use strict';
  const PREFIX = 'chatfolder:state:v1:';
  function create(provider: string): FoldHistory {
    const values = new Map<string, boolean>();
    const pending = new Map<string, boolean>();
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
            if (key.startsWith(PREFIX) && typeof value === 'boolean' && !dirty.has(key)) values.set(key, value);
          }
        } catch { /* Folding remains available without storage. */ }
      },
      key(kind, message) {
        const conversation = location.pathname.match(/\/c\/([^/]+)/)?.[1];
        if (!conversation || !message) return null;
        // One storage entry per message avoids overwriting another tab's messages.
        // IDs and booleans only: no message bodies, titles or query parameters.
        return PREFIX + JSON.stringify([provider, conversation, kind, message]);
      },
      get(key) { return key ? values.get(key) : undefined; },
      set(key, collapsed) {
        if (!key || values.get(key) === collapsed) return;
        values.set(key, collapsed);
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
          if (!key.startsWith(PREFIX) || dirty.has(key)) continue;
          if (typeof change.newValue === 'boolean') values.set(key, change.newValue);
          else values.delete(key);
          changed = true;
        }
        return changed;
      }
    };
  }
  globalThis.ChatFoldHistory = { create };
})();
