globalThis.ChatFoldProbe = () => {
  // Runs independently of message handlers, so a broken/stale engine cannot swallow diagnostics.
  const runtime = globalThis.__chatFoldRuntime;
  const roles = ['assistant', 'user', 'system', 'tool'];
  const roleAttributes = ['data-message-author-role', 'data-turn', 'data-author-role', 'data-message-role', 'data-role', 'data-conversation-role'];
  const discovery = ChatFoldDOM.scan(document);
  const summarize = (root: DOMScope): StructureSummary => ({
    articles: root.querySelectorAll('article').length,
    turns: root.querySelectorAll('[data-testid^="conversation-turn"]').length,
    modernTurns: root.querySelectorAll('[data-talvt-turn-state]').length,
    activeModernTurns: [...root.querySelectorAll('[data-talvt-turn-state]')].filter(turn => !turn.closest('[data-app-shell-active-page="false"]')).length,
    markdownBlocks: root.querySelectorAll('.markdown, .prose, [data-markdown-text-style], [data-dil-message-id]').length,
    controls: root.querySelectorAll('[data-chat-fold-control]').length,
    frames: root.querySelectorAll('iframe').length,
    roles: Object.fromEntries(roleAttributes.map(attribute => [attribute,
      Object.fromEntries(roles.map(role => [role, root.querySelectorAll(`[${attribute}="${role}"]`).length]))]))
  });
  return {
    extensionVersion: chrome.runtime.getManifest().version,
    pageVersion: runtime?.version ?? null,
    protocol: runtime?.protocol ?? null,
    legacyScript: Boolean(globalThis.ChatFold && !runtime),
    engineError: runtime?.error ?? null,
    readyState: document.readyState,
    structure: summarize(document),
    nested: {
      scanErrors: discovery.scanErrors,
      inaccessibleFrames: discovery.inaccessibleFrames,
      closedShadowRoots: discovery.closedShadowRoots,
      contexts: discovery.roots.map(({ root, kind, depth }) => ({ kind, depth, ...summarize(root) }))
    }
  };
};
