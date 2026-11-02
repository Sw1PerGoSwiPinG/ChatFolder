(() => {
  'use strict';
  const OWN = '[data-chat-fold-control], [data-chat-fold-style]';
  function errorName(value: unknown): string {
    return value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' ? value.name : 'Error';
  }
  function shadowOf(element: Element, errors: ScanError[]): ShadowRoot | null {
    if (element.matches(OWN)) return null;
    if (element.shadowRoot) return element.shadowRoot;
    // chrome.dom takes HTMLElement, not arbitrary Element. SVG icons are common
    // on ChatGPT and passing them to the API can reject the entire scan.
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return null;
    try { return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(element as HTMLElement) || null; }
    catch (error) {
      errors.push({ stage: 'shadow-access', name: errorName(error) });
      return null;
    }
  }
  function scan(document: Document): DOMDiscovery {
    const roots: DOMDiscovery["roots"] = [], seen = new Set<DOMScope>(), errors: ScanError[] = [];
    let inaccessibleFrames = 0, closedShadowRoots = 0;
    function visit(root: DOMScope | null, kind: ScopeKind, depth: number) {
      if (!root || seen.has(root)) return;
      seen.add(root);
      roots.push({ root, kind, depth });
      for (const element of root.querySelectorAll('*')) {
        if (element.matches(OWN)) continue;
        const shadow = shadowOf(element, errors);
        if (shadow) {
          if (!element.shadowRoot) closedShadowRoots++;
          visit(shadow, 'shadow', depth + 1);
        }
        if (element.localName === 'iframe' || element.localName === 'frame') {
          try {
            const child = (element as HTMLIFrameElement).contentDocument;
            if (child) visit(child, 'frame', depth + 1);
            else inaccessibleFrames++;
          } catch { inaccessibleFrames++; }
        }
      }
    }
    visit(document, 'document', 0);
    return { roots, inaccessibleFrames, closedShadowRoots,
      scanErrors: Object.entries(errors.reduce((counts, error) => {
        const key = `${error.stage}/${error.name}`;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {} as Record<string, number>)).map(([type, count]) => ({ type, count })) };
  }
  function parent(node: Element): Element | null {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    if (root.nodeType === 11 && 'host' in root) return (root as ShadowRoot).host;
    try { return (root as Document).defaultView?.frameElement || null; }
    catch { return null; }
  }
  function contains(ancestor: Element, element: Element): boolean {
    for (let current: Element | null = element; current; current = parent(current)) if (current === ancestor) return true;
    return false;
  }
  function compare(a: Element, b: Element): number {
    const path = (node: Element): Element[] => {
      const result: Element[] = [];
      for (let current: Element | null = node; current; current = parent(current)) result.unshift(current);
      return result;
    };
    const left = path(a), right = path(b);
    let i = 0;
    while (i < left.length && i < right.length && left[i] === right[i]) i++;
    if (i === left.length) return -1;
    if (i === right.length) return 1;
    const position = left[i].compareDocumentPosition(right[i]);
    return position & 1 ? 0 : position & 4 ? -1 : 1;
  }
  globalThis.ChatFoldDOM = { scan, parent, contains, compare, errorName };
})();
