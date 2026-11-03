// Run this exported function in the rendered user-folding.html fixture through
// Chrome DevTools MCP. Node's native TypeScript loader can serialize it without
// introducing transpiler helpers. These checks require real layout, not jsdom.
export async function runUserFoldingChecks() {
  const passed: string[] = [];
  const assert = (condition: unknown, label: string) => {
    if (!condition) throw new Error(label);
    passed.push(label);
  };
  const wait = () => new Promise(resolve => setTimeout(resolve, 220));
  const bubble = (id: string) => document.getElementById(id) as HTMLElement;
  const control = (id: string) => {
    const node = bubble(id).nextElementSibling;
    return node?.matches('[data-chat-fold-user-control]') ? node as HTMLElement : null;
  };
  const button = (id: string) => control(id)!.shadowRoot!.querySelector('button')!;
  const expectedHeight = (element: HTMLElement, lines: number) => {
    const style = getComputedStyle(element);
    return parseFloat(style.lineHeight) * lines + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  };
  await chrome.storage.local.set({ enabled: true, userEnabled: true, userLines: 1 });
  await wait();
  assert(control('short') === null, 'single-line input has no control');
  assert(!document.querySelector('[contenteditable] [data-chat-fold-user-collapsed]'), 'unsent composer remains intact');
  for (const id of ['wrapped', 'explicit', 'rich']) {
    assert(Boolean(control(id)), `${id}: overflow detected from real layout`);
    assert(Math.abs(bubble(id).getBoundingClientRect().height - expectedHeight(bubble(id), 1)) < 1, `${id}: exactly one rendered line`);
    assert(Math.abs(control(id)!.getBoundingClientRect().width - bubble(id).getBoundingClientRect().width) < 1, `${id}: control matches bubble width`);
    assert(Math.abs(control(id)!.getBoundingClientRect().left - bubble(id).getBoundingClientRect().left) < 1, `${id}: control aligned below bubble`);
    const clipping = getComputedStyle(bubble(id));
    assert(clipping.overflow === 'clip' && clipping.overflowClipMargin === 'content-box', `${id}: bottom padding cannot reveal part of the next line`);
  }
  const clampedHeight = bubble('wrapped').getBoundingClientRect().height;
  button('wrapped').click();
  assert(bubble('wrapped').getBoundingClientRect().height > clampedHeight, 'individual expansion restores complete input');
  await chrome.storage.local.set({ userLines: 2 });
  await wait();
  assert(!bubble('wrapped').hasAttribute('data-chat-fold-user-collapsed'), 'manual expansion survives changing limit');
  assert(Math.abs(bubble('explicit').getBoundingClientRect().height - expectedHeight(bubble('explicit'), 2)) < 1, 'explicit blank line counts toward two-line limit');
  await chrome.tabs.sendMessage(1, { type: 'chat-fold:v2:set-users', collapsed: false });
  assert(document.querySelectorAll('[data-chat-fold-user-collapsed]').length === 0, 'bulk expand restores all inputs');
  await chrome.tabs.sendMessage(1, { type: 'chat-fold:v2:set-users', collapsed: true });
  assert(Boolean(bubble('explicit').hasAttribute('data-chat-fold-user-collapsed')), 'bulk collapse reapplies line limit');

  await chrome.storage.local.set({ userLines: 3 });
  await wait();
  assert(control('responsive-text') === null, 'wide input fits three lines');
  bubble('responsive').style.width = '200px';
  await wait();
  assert(Boolean(control('responsive-text')), 'ResizeObserver detects newly overflowing narrow input');
  assert(Math.abs(control('responsive-text')!.getBoundingClientRect().width - bubble('responsive-text').getBoundingClientRect().width) < 1, 'control width updates after resize');
  bubble('responsive').style.width = '600px';
  await wait();
  assert(control('responsive-text') === null, 'growing width removes an unnecessary control');
  bubble('responsive').style.width = '200px';
  await wait();
  bubble('responsive').style.transition = 'width 140ms linear';
  bubble('responsive').style.width = '600px';
  // Background tabs may defer animation frames/ResizeObserver delivery.
  for (let attempt = 0; attempt < 10 && control('responsive-text'); attempt++) await wait();
  assert(control('responsive-text') === null, 'animated container growth is remeasured through the parent observer');
  bubble('responsive').style.removeProperty('transition');

  const saved = bubble('explicit').textContent;
  bubble('explicit').textContent = '短';
  await wait();
  assert(control('explicit') === null, 'editing to a short input removes its control');
  bubble('explicit').textContent = saved;
  await chrome.storage.local.set({ userLines: 1 });
  await wait();
  assert(Boolean(control('explicit')), 'editing back to multiline input restores its control');
  const beforeFont = bubble('wrapped').getBoundingClientRect().height;
  bubble('wrapped').style.lineHeight = '32px';
  await wait();
  assert(bubble('wrapped').getBoundingClientRect().height > beforeFont, 'style changes are remeasured without observer loops');
  bubble('wrapped').style.removeProperty('line-height');

  await chrome.storage.local.set({ userEnabled: false });
  await wait();
  assert(document.querySelectorAll('[data-chat-fold-user-control], [data-chat-fold-user-collapsed]').length === 0, 'disabling removes all clamps and controls');
  assert(bubble('explicit').style.getPropertyValue('--chatfolder-user-lines') === '7' &&
    bubble('explicit').style.getPropertyPriority('--chatfolder-user-lines') === 'important', 'original custom property and priority restored');
  await chrome.storage.local.set({ enabled: false, userEnabled: true, userLines: 1 });
  await wait();
  assert(Boolean(control('wrapped')), 'input folding works independently of answer folding');
  await chrome.storage.local.set({ enabled: true, userEnabled: true, userLines: 1 });
  await chrome.tabs.sendMessage(1, { type: 'chat-fold:v2:set-users', collapsed: true });
  return { passed, checks: passed.length };
}
