(() => {
  'use strict';
  async function run(adapter: ProviderAdapter, signal: AbortSignal, collect: (answers: string[], users: string[]) => void): Promise<VerificationResult> {
    const route = location.pathname;
    const scroller = [...document.querySelectorAll<HTMLElement>('.thread-scroll-container')].find(e=>!e.closest('[data-app-shell-active-page="false"]'));
    const answers = new Set<string>(), users = new Set<string>();
    let interrupted = false;
    const interrupt = () => { interrupted = true; };
    const keyInterrupt = (event: KeyboardEvent) => { if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Escape',' '].includes(event.key)) interrupt(); };
    const original = scroller?.scrollTop || 0;
    const pause = () => new Promise<void>(resolve => setTimeout(resolve, 180));
    const cancelled = () => signal.aborted || interrupted || location.pathname !== route;
    const sample = () => {
      const discovery = ChatFoldDOM.scan(document);
      const a = adapter.findAnswers(document, discovery), u = adapter.findUserMessages?.(document, discovery) || [];
      if (a.some(m=>!m.key) || u.some(m=>!m.key)) return false;
      a.forEach(m=>answers.add(m.key!)); u.forEach(m=>users.add(m.key!));
      collect([...answers], [...users]);
      return a.length > 0;
    };
    // Without a recognized conversation scroller, a DOM snapshot is only partial.
    if (!scroller) { sample(); return { answers: [...answers], users: [...users], complete: false }; }
    document.addEventListener('wheel', interrupt, { capture: true, passive: true });
    document.addEventListener('touchstart', interrupt, { capture: true, passive: true });
    document.addEventListener('pointerdown', interrupt, true);
    document.addEventListener('keydown', keyInterrupt, true);
    let complete = false;
    try {
      scroller.scrollTop = 0;
      await pause(); await pause();
      if (scroller.scrollTop > 2) return { answers: [], users: [], complete: false };
      const deadline = Date.now() + 90000;
      for (let step = 0; step < 250 && Date.now() < deadline && !cancelled(); step++) {
        if (!sample()) break;
        if ([...document.querySelectorAll('[data-talvt-turn-state]')].some(e=>!e.closest('[data-app-shell-active-page="false"]') && e.getAttribute('data-talvt-turn-state') !== 'complete')) break;
        const top = scroller.scrollTop, height = scroller.clientHeight, end = scroller.scrollHeight - height;
        if (height <= 0) break;
        if (top >= end - 2) {
          const oldHeight = scroller.scrollHeight, oldCount = answers.size;
          await pause(); await pause();
          if (!cancelled() && sample() && scroller.scrollHeight === oldHeight && scroller.scrollTop >= scroller.scrollHeight - height - 2 && oldCount === answers.size) complete = true;
          if (complete) break;
        }
        const next = Math.min(end, top + Math.max(1, height * .65));
        scroller.scrollTop = next;
        await pause(); await pause();
        // Scroll anchoring or changing layout can skip turns. Never certify that scan.
        if (Math.abs(scroller.scrollTop - next) > height * .25 || (next <= top && !complete)) break;
      }
      return { answers: [...answers], users: [...users], complete: complete && !cancelled() };
    } finally {
      document.removeEventListener('wheel', interrupt, true); document.removeEventListener('touchstart', interrupt, true);
      document.removeEventListener('pointerdown', interrupt, true); document.removeEventListener('keydown', keyInterrupt, true);
      if (!interrupted && location.pathname === route) {
        scroller.scrollTop = original;
        // Give the site's virtualizer time to remount the reading position before
        // the engine reapplies saved folds to the restored viewport.
        await pause(); await pause();
      }
    }
  }
  globalThis.ChatFoldVerify = { run };
})();
