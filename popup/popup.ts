(() => {
"use strict";
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing popup element: ${id}`);
  return node as T;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function requireTab(): number {
  if (tabId === undefined) throw new Error('No active ChatGPT tab');
  return tabId;
}
const defaults: FoldSettings = { enabled: true, defaultCollapsed: true, userEnabled: true, userLines: 1 };
let tabId: number | undefined;
const status = element<HTMLElement>("status");
const error = element<HTMLElement>("error");
const bulkButtons = [element<HTMLButtonElement>("collapse"), element<HTMLButtonElement>("expand")];
const userButtons = [element<HTMLButtonElement>('collapse-users'), element<HTMLButtonElement>('expand-users')];
const userLines = element<HTMLInputElement>('userLines');
let savedUserLines = defaults.userLines;

function showError(message: string): void { error.textContent = message; error.hidden = false; }

async function request(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(requireTab(), { type: `chat-fold:v2:${action}`, ...data }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('页面脚本响应超时')), 2500); })
    ]);
  } finally { clearTimeout(timeout); }
}

function validStatus(result: unknown): result is FoldStatus {
  return isRecord(result) && result.protocol === 2 && typeof result.version === 'string' &&
    typeof result.enabled === 'boolean' && Number.isInteger(result.total) && Number.isInteger(result.collapsed) &&
    isRecord(result.users) && typeof result.users.enabled === 'boolean' && Number.isInteger(result.users.total) && Number.isInteger(result.users.collapsed);
}

async function connect() {
  try {
    const result = await request('status');
    if (validStatus(result) && result.version === chrome.runtime.getManifest().version) return result;
  } catch { /* Reconnect by safely reinjecting the page engine. */ }
  await chrome.scripting.insertCSS({ target: { tabId: requireTab() }, files: ['content/content.css'] });
  await chrome.scripting.executeScript({ target: { tabId: requireTab() }, files: [
    'build/content/dom.js', 'build/content/registry.js', 'build/content/adapters/chatgpt.js', 'build/content/user-fold.js', 'build/content/engine.js'
  ] });
  const result = await request('status');
  if (!validStatus(result) || result.version !== chrome.runtime.getManifest().version) throw new Error('连接失败，请刷新 ChatGPT 页面后重试。');
  return result;
}

async function refresh() {
  if (!tabId) return;
  try {
    const result = await connect();
    if (result.error) throw new Error('页面暂不可用，请刷新后重试。');
    error.hidden = true;
    status.textContent = !result.enabled ? "AI 回答折叠已暂停。" : result.total
      ? `${result.total} 次回答 · ${result.collapsed} 次已收起` : "暂无回答。";
    bulkButtons.forEach(button => { button.disabled = !result.enabled || !result.total; });
    userButtons.forEach(button => { button.disabled = !result.users.enabled || !result.users.total; });
  } catch {
    status.textContent = "连接失败，请刷新 ChatGPT 页面后重试。";
    bulkButtons.forEach(button => { button.disabled = true; });
    userButtons.forEach(button => { button.disabled = true; });
  }
}

async function init() {
  try {
    const settings = await chrome.storage.local.get({ ...defaults });
    for (const key of ['enabled', 'defaultCollapsed', 'userEnabled'] as const) {
      const input = element<HTMLInputElement>(key);
      input.checked = typeof settings[key] === 'boolean' ? settings[key] : defaults[key];
      input.addEventListener("change", async () => {
        input.disabled = true;
        if (key === 'userEnabled') userLines.disabled = !input.checked;
        error.hidden = true;
        try { await chrome.storage.local.set({ [key]: input.checked }); await refresh(); }
        catch { input.checked = !input.checked; showError("设置未保存，请重试。"); }
        finally { input.disabled = false; if (key === 'userEnabled') userLines.disabled = !input.checked; }
      });
    }
    savedUserLines = typeof settings.userLines === 'number' && Number.isSafeInteger(settings.userLines) && settings.userLines >= 1 ? settings.userLines : 1;
    userLines.value = String(savedUserLines);
    userLines.disabled = !element<HTMLInputElement>('userEnabled').checked;
    userLines.addEventListener('change', async () => {
      const value = userLines.valueAsNumber;
      if (!Number.isSafeInteger(value) || value < 1) {
        userLines.value = String(savedUserLines);
        showError('显示行数必须是大于或等于 1 的整数。');
        return;
      }
      userLines.disabled = true;
      error.hidden = true;
      try { await chrome.storage.local.set({ userLines: value }); savedUserLines = value; await refresh(); }
      catch { userLines.value = String(savedUserLines); showError('行数未保存，请重试。'); }
      finally { userLines.disabled = !element<HTMLInputElement>('userEnabled').checked; }
    });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url)) {
      status.textContent = "请在 ChatGPT 页面使用。";
      return;
    }
    tabId = tab.id;
    await refresh();
  } catch { showError("暂时无法读取设置，请重新打开扩展。"); }
}

bulkButtons.forEach((button, index) => button.addEventListener("click", async () => {
  error.hidden = true;
  try {
    const result = await request('set-all', { collapsed: index === 0 });
    if (!isRecord(result) || result.ok !== true) throw new Error('Invalid response');
    await refresh();
  } catch { showError("操作未完成，请刷新页面后重试。"); }
}));
userButtons.forEach((button, index) => button.addEventListener('click', async () => {
  error.hidden = true;
  try {
    const result = await request('set-users', { collapsed: index === 0 });
    if (!isRecord(result) || result.ok !== true) throw new Error('Invalid response');
    await refresh();
  } catch { showError('输入折叠操作未完成，请刷新页面后重试。'); }
}));
element<HTMLElement>('version').textContent = `v${chrome.runtime.getManifest().version}`;
init();

})();
