(() => {
  'use strict';
  const ENTRY = 'chatfolder:index:v1:', SNAPSHOT = 'chatfolder:catalog:v1:';
  interface Entry { at: number; rank: number; }
  interface Snapshot { answers: string[]; users: string[]; at: number; invalid?: boolean; }
  const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object';
  const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100000 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 1000) && new Set(value).size === value.length;
  function create(history: FoldHistory, provider: string): ConversationCatalog {
    let conversation = '', snapshot: Snapshot | null = null, invalid = false;
    let ordered: Partial<Record<MessageKind, string[]>> = {};
    let rows: Record<MessageKind, Map<string, Entry>> = { answer: new Map(), user: new Map() };
    const current = () => location.pathname.match(/\/c\/([^/]+)/)?.[1] || location.pathname;
    const entryKey = (kind: MessageKind, id: string) => ENTRY + JSON.stringify([provider, current(), kind, id]);
    const snapshotKey = () => SNAPSHOT + JSON.stringify([provider, current()]);
    function refresh() {
      conversation = current(); ordered = {}; rows = { answer: new Map(), user: new Map() }; snapshot = null; invalid = false;
      const value = history.read(snapshotKey());
      if (isObject(value) && list(value.answers) && list(value.users) && typeof value.at === 'number' && Number.isFinite(value.at)) snapshot = value as unknown as Snapshot;
      invalid = snapshot?.invalid === true;
      for (const [key, value] of history.entries()) {
        if (!key.startsWith(ENTRY)) continue;
        try {
          const [p, c, kind, id] = JSON.parse(key.slice(ENTRY.length));
          if (p === provider && c === conversation && (kind === 'answer' || kind === 'user') && typeof id === 'string' && isObject(value) && typeof value.at === 'number' && Number.isFinite(value.at) && typeof value.rank === 'number' && Number.isFinite(value.rank)) rows[kind as MessageKind].set(id, value as unknown as Entry);
        } catch { /* Ignore malformed or future storage records. */ }
      }
      // Migrate previous versions' stable fold records without assuming completeness.
      for (const [key, value] of history.entries()) {
        if (!key.startsWith('chatfolder:state:v1:') || typeof value !== 'boolean') continue;
        try {
          const [p, c, kind, id] = JSON.parse(key.slice('chatfolder:state:v1:'.length));
          if (p === provider && c === conversation && (kind === 'answer' || kind === 'user') && typeof id === 'string' && !rows[kind as MessageKind].has(id)) rows[kind as MessageKind].set(id, { at: 0, rank: rows[kind as MessageKind].size });
        } catch { /* Old anonymous records cannot form an index. */ }
      }
    }
    const ensure = () => { if (conversation !== current()) refresh(); };
    function ids(kind: MessageKind): string[] {
      ensure();
      if (ordered[kind]) return ordered[kind]!;
      const base = snapshot ? (kind === 'answer' ? snapshot.answers : snapshot.users) : [];
      const membership = new Set(base);
      const extra = [...rows[kind as MessageKind]].filter(([id, e]) => !membership.has(id) && (!snapshot || e.at > snapshot.at)).sort((a,b) => a[1].rank - b[1].rank || a[0].localeCompare(b[0])).map(([id]) => id);
      if (!snapshot) return ordered[kind] = extra;
      const all = [...base, ...extra];
      const ranks = new Map(base.map((id, index) => [id, index]));
      const rank = (id: string) => ranks.get(id) ?? rows[kind].get(id)!.rank;
      return ordered[kind] = all.sort((a,b) => rank(a) - rank(b));
    }
    const api: ConversationCatalog = {
      refresh,
      ids,
      observe(kind, observed) {
        ensure(); const unique = [...new Set(observed.filter(Boolean))];
        for (let i = 0; i < unique.length; i++) {
          const id = unique[i], existing = rows[kind as MessageKind].get(id);
          const base = snapshot ? (kind === 'answer' ? snapshot.answers : snapshot.users) : null;
          if (existing && (!base || base.includes(id) || existing.at > snapshot!.at)) continue;
          const left = [...unique.slice(0,i)].reverse().map(id=>rows[kind as MessageKind].get(id)).find(Boolean);
          const right = unique.slice(i+1).map(id=>rows[kind as MessageKind].get(id)).find(Boolean);
          const rank = left && right && left.rank < right.rank ? (left.rank + right.rank) / 2 : left ? left.rank + 1 : right ? right.rank - (unique.length - i) : rows[kind as MessageKind].size;
          const entry = { at: Math.max(Date.now(), (snapshot?.at || 0) + 1), rank };
          rows[kind as MessageKind].set(id, entry);
          delete ordered[kind];
          if (location.pathname.includes('/c/')) history.write(entryKey(kind, id), entry);
        }
        // Keep the relative order observed in the DOM, including older turns loaded later.
        for (let i = 1; i < unique.length; i++) {
          const a = rows[kind as MessageKind].get(unique[i-1])!, b = rows[kind as MessageKind].get(unique[i])!;
          if (a.rank >= b.rank) invalid = true;
        }
      },
      count(kind, fallback) {
        const messages = ids(kind);
        return { total: messages.length, collapsed: messages.filter(id => history.get(history.key(kind, id)) ?? fallback).length };
      },
      setAll(kind, collapsed) { for (const id of ids(kind)) history.set(history.key(kind, id), collapsed); },
      confirm(answers, users) {
        ensure();
        if (!list(answers) || !list(users)) return;
        const at = [...rows.answer.values(), ...rows.user.values()].reduce((latest, entry) => Math.max(latest, entry.at + 1), Date.now());
        const confirmed: Snapshot = { answers: [...answers], users: [...users], at };
        snapshot = confirmed; ordered = {}; invalid = false;
        for (const [kind, messages] of [['answer', answers], ['user', users]] as const) {
          messages.forEach((id, rank) => { const entry = { at, rank }; rows[kind as MessageKind].set(id, entry); if (location.pathname.includes('/c/')) history.write(entryKey(kind,id),entry); });
        }
        if (location.pathname.includes('/c/')) history.write(snapshotKey(), confirmed);
        snapshot = confirmed; ordered = {}; invalid = false;
      },
      invalidate() { ensure(); invalid = true; if (snapshot) { snapshot = { ...snapshot, invalid: true }; if (location.pathname.includes('/c/')) history.write(snapshotKey(), snapshot); } },
      status() {
        ensure();
        const extra = snapshot && (ids('answer').length !== snapshot.answers.length || ids('user').length !== snapshot.users.length);
        return { complete: !!snapshot && !extra && !invalid && Date.now() - snapshot.at < 300000, verifiedAt: snapshot?.at ?? null, verifying: false };
      }
    };
    return api;
  }
  globalThis.ChatFoldCatalog = { create };
})();
