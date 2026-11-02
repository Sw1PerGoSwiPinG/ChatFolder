(() => {
"use strict";
interface DiagnosticError extends Error { code?: string; phase?: string }
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing popup element: ${id}`);
  return node as T;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function asError(value: unknown): DiagnosticError {
  return value instanceof Error ? value : new Error(String(value));
}
function requireTab(): number {
  if (tabId === undefined) throw new Error('No active ChatGPT tab');
  return tabId;
}
const defaults = { enabled: true, defaultCollapsed: true };
let tabId: number | undefined;
const status = element<HTMLElement>("status");
const error = element<HTMLElement>("error");
const bulkButtons = [element<HTMLButtonElement>("collapse"), element<HTMLButtonElement>("expand")];

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

async function probe(): Promise<DiagnosticResponse> {
  let phase = 'load-diagnostic-files';
  try {
    await chrome.scripting.executeScript({ target: { tabId: requireTab() }, files: ['build/content/dom.js', 'build/content/probe.js'] });
    // Explicitly return a JSON value; do not rely on file-injection completion values.
    phase = 'run-diagnostic-function';
    const results = await chrome.scripting.executeScript({ target: { tabId: requireTab() }, func: () => {
      try {
        if (typeof globalThis.ChatFoldProbe !== 'function') return { error: 'PROBE_NOT_LOADED' };
        return globalThis.ChatFoldProbe();
      } catch (error) {
        return { error: 'PROBE_RUNTIME_ERROR', exception: { name: error instanceof Error ? error.name : 'Error' } };
      }
    } });
    const result: DiagnosticResponse | undefined = results?.find(entry => entry.frameId === 0)?.result ?? results?.[0]?.result;
    if (!result || typeof result !== 'object') {
      const error: DiagnosticError = new Error('诊断函数没有返回对象');
      error.code = 'PROBE_EMPTY_RESULT';
      throw error;
    }
    if (result.error) result.phase = phase;
    return result;
  } catch (error) { const failure = asError(error); failure.phase = phase; throw failure; }
}

function safeErrorMessage(error: unknown): string {
  // Retain API/file/type errors, strip URLs, IDs and local filesystem locations.
  return String(asError(error).message || 'Unknown error')
    .replace(/(?:https?|file|chrome-extension):\/\/[^\s<>"']+/gi, '[URL]')
    .replace(/[A-Z]:[\\/][^\r\n"']+/gi, '[local path]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[ID]')
    .slice(0, 500);
}

function validStatus(result: unknown): result is FoldStatus {
  return isRecord(result) && result.protocol === 2 && typeof result.version === 'string' &&
    typeof result.enabled === 'boolean' && Number.isInteger(result.total) && Number.isInteger(result.collapsed);
}

async function connect() {
  try {
    const result = await request('status');
    if (validStatus(result) && result.version === chrome.runtime.getManifest().version) return result;
  } catch { /* Probe separately before attempting a safe, idempotent reinjection. */ }
  const diagnostic = await probe();
  if (diagnostic.error) throw new Error(`诊断执行异常（${diagnostic.error}），请读取诊断信息。`);
  if (diagnostic.legacyScript || (diagnostic.pageVersion && diagnostic.pageVersion !== chrome.runtime.getManifest().version)) {
    throw new Error('检测到旧版页面脚本。请点击「刷新页面并重连」，避免新旧脚本冲突。');
  }
  await chrome.scripting.insertCSS({ target: { tabId: requireTab() }, files: ['content/content.css'] });
  await chrome.scripting.executeScript({ target: { tabId: requireTab() }, files: [
    'build/content/dom.js', 'build/content/registry.js', 'build/content/adapters/chatgpt.js', 'build/content/engine.js'
  ] });
  const result = await request('status');
  if (!validStatus(result)) throw new Error('页面脚本未正确启动，请读取兼容性诊断。');
  return result;
}

async function refresh() {
  if (!tabId) return;
  try {
    const result = await connect();
    element<HTMLElement>("provider").textContent = result.provider;
    if (result.error) throw new Error(`页面脚本出错（${result.error.stage}/${result.error.name}），请读取兼容性诊断。`);
    error.hidden = true;
    status.textContent = !result.enabled ? "专注模式已暂停，回答已恢复显示。" : result.total
      ? `${result.total} 次回答 · ${result.collapsed} 次已收起` : "暂未识别到回答；如页面已有对话，请查看兼容性诊断。";
    bulkButtons.forEach(button => { button.disabled = !result.enabled || !result.total; });
  } catch (failure) {
    status.textContent = asError(failure).message || "请刷新 ChatGPT 页面，让ChatFolder开始工作。";
    bulkButtons.forEach(button => { button.disabled = true; });
  }
}

async function init() {
  try {
    const settings = await chrome.storage.local.get(defaults);
    for (const key of (Object.keys(defaults) as (keyof FoldSettings)[])) {
      const input = element<HTMLInputElement>(key);
      input.checked = typeof settings[key] === 'boolean' ? settings[key] : defaults[key];
      input.addEventListener("change", async () => {
        input.disabled = true;
        error.hidden = true;
        try { await chrome.storage.local.set({ [key]: input.checked }); await refresh(); }
        catch { input.checked = !input.checked; showError("设置未保存，请重试。"); }
        finally { input.disabled = false; }
      });
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab.url)) {
      status.textContent = "在 ChatGPT 网页打开ChatFolder，即可管理回答。";
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
element<HTMLButtonElement>("diagnose").addEventListener("click", async () => {
  if (!tabId) { showError("请先打开 ChatGPT 会话页面。"); return; }
  try {
    const result = await probe();
    const output = element<HTMLTextAreaElement>("diagnosticOutput");
    output.value = JSON.stringify(result, null, 2);
    output.hidden = false;
  } catch (failure) {
    // Even a failed probe produces copyable, valid JSON instead of the string undefined.
    const output = element<HTMLTextAreaElement>('diagnosticOutput');
    let engine = null;
    try { engine = await request('diagnose'); } catch { /* Independent message fallback is best effort. */ }
    output.value = JSON.stringify({ extensionVersion: chrome.runtime.getManifest().version,
      error: asError(failure).code || 'PROBE_INJECTION_FAILED', phase: asError(failure).phase || 'unknown',
      exception: { name: asError(failure).name || 'Error', message: safeErrorMessage(failure) },
      engine: engine && typeof engine === 'object' ? engine : null }, null, 2);
    output.hidden = false;
    showError('诊断执行失败，请复制下方错误信息。');
  }
});
element<HTMLButtonElement>('reload').addEventListener('click', async () => {
  if (!tabId) { showError('请先打开 ChatGPT 页面。'); return; }
  try { await chrome.tabs.reload(tabId); window.close(); }
  catch { showError('刷新失败，请手动刷新 ChatGPT 页面。'); }
});
element<HTMLElement>('version').textContent = `v${chrome.runtime.getManifest().version}`;
init();

})();
