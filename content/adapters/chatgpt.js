(() => {
  "use strict";
  const ASSISTANT = '[data-message-author-role="assistant"], [data-turn="assistant"], [data-author-role="assistant"], [data-message-role="assistant"], [data-role="assistant"], [data-testid="assistant-message"], .agent-turn';
  const USER = '[data-message-author-role="user"], [data-turn="user"], [data-author-role="user"], [data-message-role="user"], [data-role="user"], [data-testid="user-message"], [data-testid="user-message-bubble"], [data-conversation-role="user"], [data-user-message-bubble]';
  const TURN = '[data-testid^="conversation-turn"], article, [data-turn="assistant"], [data-turn="user"]';
  const BODY = '.markdown, .prose, [data-testid="markdown"], [data-message-content]';
  const MODERN_ASSISTANT = '[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]';
  const MODERN_TURN = '[data-talvt-turn-state]';

  function inactive(element) {
    for (let node = element; node; node = ChatFoldDOM.parent(node)) {
      if (node.getAttribute('data-app-shell-active-page') === 'false') return true;
    }
    return false;
  }

  function modernAnswers(root) {
    return [...root.querySelectorAll(MODERN_TURN)].flatMap(turn => {
      if (inactive(turn) || !turn.querySelector(MODERN_ASSISTANT)) return [];
      const elements = [];
      function partition(node) {
        if (node.matches('[data-chat-fold-control], [data-chat-fold-style], script, style, template')) return;
        if (node.matches(USER)) return;
        const hasUser = Boolean(node.querySelector(USER));
        if (!hasUser) { elements.push(node); return; }
        // Preserve the whole user block, including its original buttons and attachments.
        if (!node.querySelector(MODERN_ASSISTANT)) return;
        for (const child of node.children) partition(child);
      }
      for (const child of turn.children) partition(child);
      if (!elements.length) return [];
      const identified = turn.closest('[data-turn-key], [data-content-search-turn-key]');
      return [{ element: elements[0], elements,
        key: identified?.getAttribute('data-turn-key') || identified?.getAttribute('data-content-search-turn-key') || null }];
    });
  }

  function speaker(element) {
    // ChatGPT also exposes the speaker through accessible headings, without role attributes.
    const headings = [...element.querySelectorAll('h5, h6, [role="heading"], .sr-only')];
    const labels = [element.getAttribute('aria-label'), ...headings
      .filter(node => !node.closest(BODY))
      .map(node => node.textContent)].filter(Boolean);
    if (labels.some(label => /^(?:you said|you|用户|你说|你说过|您说|你)[：:\s]*$/i.test(label.trim()))) return 'user';
    if (labels.some(label => /^(?:chatgpt(?: said| says| 说| 说过)?|assistant|助手)[：:\s]*$/i.test(label.trim()))) return 'assistant';
    return null;
  }

  function containsUser(element) {
    return element.matches(USER) || Boolean(element.querySelector(USER)) || speaker(element) === 'user';
  }

  function findInRoot(document) {
    const candidates = new Set();
    for (const message of document.querySelectorAll(ASSISTANT)) {
      if (inactive(message) || insideUser(message)) continue;
      const turn = message.closest(TURN);
      const container = turn && !containsUser(turn) ? turn : message;
      if (!containsUser(container)) candidates.add(container);
    }
    // Fallbacks are limited to conversation turns: never infer roles from turn order
    // or search globally for Markdown (the composer and user messages may contain it).
    for (const turn of document.querySelectorAll(TURN)) {
      if (inactive(turn) || containsUser(turn) || insideUser(turn)) continue;
      const role = speaker(turn);
      if (role === 'assistant' || (role === null && turn.querySelector(BODY))) candidates.add(turn);
    }
    return [...candidates].filter(element =>
      ![...candidates].some(other => other !== element && other.contains(element)));
  }

  function insideUser(element) {
    for (let node = element; node; node = ChatFoldDOM.parent(node)) {
      if (node.matches(USER) || (node.matches(TURN) && speaker(node) === 'user')) return true;
    }
    return false;
  }

  function findAnswers(document, scopes = ChatFoldDOM.scan(document)) {
    const modern = scopes.roots.flatMap(({ root }) => modernAnswers(root));
    const candidates = scopes.roots.flatMap(({ root }) => findInRoot(root));
    const elements = candidates.filter(element => !candidates.some(other =>
      other !== element && ChatFoldDOM.contains(other, element)) &&
      !modern.some(answer => answer.elements.some(part => ChatFoldDOM.contains(part, element))));
    elements.sort(ChatFoldDOM.compare);
    const legacy = elements.map(element => {
      const identified = element.matches('[data-message-id]') ? element : element.querySelector('[data-message-id]');
      return { element, key: identified?.getAttribute('data-message-id') || element.id || element.getAttribute('data-testid') || null };
    });
    return [...modern, ...legacy].sort((a, b) => ChatFoldDOM.compare(a.element, b.element));
  }

  ChatFold.register({
    id: "chatgpt",
    label: "ChatGPT",
    matches: location => ["chatgpt.com", "chat.openai.com"].includes(location.hostname),
    findAnswers,
    diagnose(document) {
      // Structural metadata only: no text, URLs, message IDs or HTML are exported.
      const attributes = ['data-message-author-role', 'data-turn', 'data-author-role', 'data-message-role', 'data-role', 'data-conversation-role'];
      const knownRoles = new Set(['assistant', 'user', 'system', 'tool']);
      return {
        turns: document.querySelectorAll(TURN).length,
        modernTurns: document.querySelectorAll(MODERN_TURN).length,
        roleCounts: Object.fromEntries(attributes.map(name => [name,
          [...document.querySelectorAll(`[${name}]`)].reduce((counts, node) => {
            const value = node.getAttribute(name);
            const role = knownRoles.has(value) ? value : 'other';
            counts[role] = (counts[role] || 0) + 1;
            return counts;
          }, {})])),
        markdownBlocks: document.querySelectorAll(BODY).length,
        assistantLabels: [...document.querySelectorAll(TURN)].filter(turn => speaker(turn) === 'assistant').length,
        frames: document.querySelectorAll('iframe').length,
        detectedAnswers: findAnswers(document).length
      };
    }
  });
})();
