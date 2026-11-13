// Evaluate in /c/virtual-<unique-name> served by test:browser-fixture.
export async function runCatalogChecks() {
  const message = (action: string, extra = {}) => chrome.tabs.sendMessage(1, {type: `chat-fold:v2:${action}`, ...extra});
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); };
  const before = await message('status');
  await message('verify');
  let verified;
  for (let i=0;i<80;i++) {
    await new Promise(resolve=>setTimeout(resolve,200));
    verified=await message('status');
    if (!verified.index.verifying) break;
  }
  assert(verified.total===6 && verified.users.total===6 && verified.index.complete, 'complete six-turn inventory');
  await message('set-all',{collapsed:false}); await message('set-users',{collapsed:true});
  document.querySelector<HTMLElement>('.thread-scroll-container')!.scrollTop=2000;
  await new Promise(resolve=>setTimeout(resolve,250));
  const bulk=await message('status');
  assert(bulk.total===6 && bulk.collapsed===0 && bulk.users.collapsed===6, 'bulk choices cover unmounted messages');
  assert(document.querySelectorAll('[data-message-id]').length===2, 'only two turns remain mounted');
  assert(document.querySelector('[data-chat-fold-control]:not([data-chat-fold-user-control])')!.shadowRoot!.querySelector('.number')!.textContent==='05', 'absolute verified numbering');
  return {before,verified,bulk};
}
export async function checkCatalogReload() {
  const status=await chrome.tabs.sendMessage(1,{type:'chat-fold:v2:status'});
  if(status.total!==6 || status.collapsed!==0 || status.users.collapsed!==6) throw new Error('Index or choices lost after reload');
  return status;
}
