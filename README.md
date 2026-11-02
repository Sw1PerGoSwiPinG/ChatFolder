# ChatFolder · 留白

项目仓库名称为 **ChatFolder**，Chrome 扩展显示名称保持「留白 · Chat Fold」。

当前版本：**1.0.5**。已通过 Chrome DevTools MCP 在用户真实 Chrome 页面验证。

一个 Chrome Manifest V3 扩展。默认收起 ChatGPT 的每次回答，让用户问题成为清晰的对话目录；点击对应的「展开回答」查看，再点击「收起回答」恢复。

## 安装到 Chrome

1. 下载或保留整个项目文件夹。
2. 在 Chrome 地址栏输入 `chrome://extensions`，打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的文件夹（本项目根目录）。
4. 打开或刷新 [ChatGPT](https://chatgpt.com/)，建议把「留白」固定到浏览器工具栏。

**源码安装需先执行 `npm ci` 和 `npm run build`。** 详见 [开发说明](DEVELOPMENT.md)。 不要只选择 `content` 或 `popup` 子目录。安装或更新扩展后，已打开的 ChatGPT 页面需要刷新一次。

## 使用

- 默认隐藏整个 AI 回答区域，包含回答文字、代码、附属操作按钮；保留原始用户消息和每次回答的展开/收起按钮。
- 每条回答可以独立展开；展开后仍可使用原站复制、代码和其他回答操作。
- 浏览器工具栏弹窗支持「全部收起」「全部展开」。批量操作只作用于当前页面已有回答。
- 关闭「专注模式」立即恢复原始回答；关闭「新回答自动收起」后，新出现的回答默认展开，已有回答保持当前状态。
- 设置保存在浏览器本地，作用于已打开的受支持页面。单次回答的展开状态仅保留在当前标签页的当前会话内，刷新或切换会话后使用默认设置。
- 流式输出期间也会折叠，新回答出现后会自动加入。页面顶部导航、侧栏、输入框等 ChatGPT 原有功能仍保留。

## 隐私与权限

不请求外部网络、不上传或保存聊天正文，无后台服务。`storage` 用于保存两个开关；`activeTab` 用于弹窗识别当前页并发送操作；`scripting` 配合用户点击扩展获得的当前标签页权限，在 ChatGPT 页面独立读取结构诊断并补注入未启动的内容脚本。内容脚本仅在 `https://chatgpt.com/*` 与旧域名 `https://chat.openai.com/*` 运行。折叠通过 DOM 属性和 CSS 实现，不删除原始回答节点。

## 目录与扩展厂商

```text
manifest.json                 Chrome 入口、域名白名单、脚本加载顺序
content/dom.js                跨 Shadow DOM / 同源 iframe 的结构发现与排序
content/registry.js           适配器注册接口与默认设置
content/adapters/chatgpt.js   ChatGPT 消息发现与稳定标识
content/engine.js             独立状态、DOM 监听、折叠控件与消息通信
content/probe.js              独立诊断脚本，不依赖折叠引擎的消息响应
content/content.css           隐藏标记样式
popup/                        工具栏弹窗
tests/engine.test.ts          DOM 集成测试
```

Gemini、DeepSeek **尚未实现**。添加支持时：

1. 新建 `content/adapters/<provider>.js`，按下方接口注册。
2. 在 `manifest.json` 的 `matches` 加入目标 HTTPS 域名，在 `js` 中把适配器放在 `engine.js` 前。
3. 更新 `popup/popup.js` 的受支持域名判断。
4. 为目标网站真实 DOM 添加测试，验证用户消息、生成中消息、分支切换及流式更新。

```js
ChatFold.register({
  id: 'provider',
  label: 'Provider',
  matches: location => location.hostname === 'provider.example',
  findAnswers(document) {
    // 返回完整的 AI 回答容器，绝不能包含用户消息或输入框。
    // key 优先用稳定消息 ID，不用正文；没有稳定 ID 时可返回 null。
    return [{ element: /* DOM element */, key: /* message ID or null */ }];
  }
});
```

引擎负责生成 Shadow DOM 按钮、监听动态节点、恢复页面及管理开关。适配器只负责找回答，不需要复制引擎代码。新站点尚无完整消息容器时可退回到回答正文容器，但可能保留站点头像或工具栏。

## 开发与验证

需要 Node.js 20+：

```powershell
npm ci
npm run check
npm test
```

测试使用 jsdom 构造页面，覆盖折叠/展开、用户消息保护、流式追加、节点替换、会话切换、批量操作、暂停恢复与新回答默认设置。开发依赖不进入扩展运行环境。

Chrome 实测建议：打开一个多轮会话；逐条展开；发送新问题观察流式输出；切换会话；关闭专注模式确认回答恢复；在代码回答中验证复制操作。ChatGPT 是持续更新的第三方网页，若其 DOM 标记变化，需调整 `content/adapters/chatgpt.js`。当前自动测试基于代表性 DOM，不等同于登录账号后的实际站点验证。

## 打包

在项目根目录执行以下 PowerShell 命令，得到可分发的扩展 ZIP（开发者模式安装时需先解压）：

```powershell
New-Item -ItemType Directory -Force dist
Compress-Archive -Path manifest.json,build,content,popup -DestinationPath dist/chat-fold-1.0.5.zip -Force
```

上架 Chrome 应用商店还需另行准备商店截图、图标和发布资料；当前交付可直接使用开发者模式加载。

## 1.0.1 兼容性修复

- 除角色属性外，支持回合内说话人标签、Markdown 正文、agent-turn 容器等消息结构，并合并同一回答的嵌套匹配。
- 监听页面延迟添加的消息类名和角色属性，覆盖异步渲染的回答。
- 找不到回答时不再断言会话为空。弹窗新增「兼容性诊断」，可读取结构计数与版本，不包含聊天正文、会话地址或消息 ID。

更新本地文件后，必须在 `chrome://extensions` 点击「留白」卡片的重新加载按钮，再刷新 ChatGPT 页面。若扩展加载自 ZIP 解压目录，需先用新版文件覆盖该目录或重新选择本项目根目录。

## 1.0.2 通信与诊断修复

- 弹窗使用带版本的消息协议，校验响应；旧版页面脚本不会抢答新版请求。检测到旧脚本时提示刷新页面，避免同时运行两套折叠逻辑。
- 内容脚本未启动时，弹窗可补注入本地打包的脚本和 CSS；新引擎可安全重复注入，会清理上一个引擎的监听器、计时器和按钮。
- 诊断通过独立脚本读取，不依赖原来的消息监听器。即使页面响应为 `undefined` 或引擎出错，也能提供结构化诊断或明确错误，不再显示 `undefined`。诊断不含聊天正文、会话 URL 和消息 ID。
- 按钮使用 DOM API 创建，不再写入 `innerHTML`，兼容限制 HTML 字符串写入的 Trusted Types 环境。
- 诊断栏显示当前弹窗版本，并提供「刷新页面并重连」。刷新前请保留未发送的草稿，等待正在生成的回答结束。

升级时请确认诊断栏显示 **v1.0.2**；若仍是旧版本，说明 Chrome 加载的是另一份解压目录。加载本项目根目录 `D:\bupt\VibeCoding\chat_fold` 即可使用最新源码。新增了 `scripting` 权限，Chrome 如提示扩展更新或权限变化，需要在扩展管理界面检查并启用该版本。

## 1.0.3 嵌套页面修复

收到的真实诊断显示引擎正常运行，但顶层文档没有 article、Markdown 和消息角色，同时存在 3 个 Shadow DOM 与 1 个 iframe。此前识别只搜索顶层文档，无法发现这些嵌套区域中的回答。

- 递归搜索多层 Shadow DOM 和同源 iframe。Chrome 提供 `chrome.dom.openOrClosedShadowRoot` 时也可读取 closed Shadow DOM，不修改页面的 `attachShadow`。
- 在每个文档和 Shadow DOM 中分别加入隐藏样式及变更监听，覆盖嵌套区域内的新回答、流式更新和节点重建；按钮自己的 Shadow DOM 不参与搜索。
- 监听 iframe 加载，并定期发现延迟创建的 Shadow DOM、iframe 文档替换。跨区域按页面顺序排列按钮，不会因嵌套识别重复添加按钮。
- 诊断新增 `nested.contexts`，逐层显示结构计数，以及无法读取的 iframe 数量。跨域 iframe 仍受浏览器同源权限限制，不申请任意网站访问权限。
- 弹窗拒绝版本不一致的页面脚本，提示刷新后再连接。

该版本的回归测试包含「顶层 0 个 article、3 个 Shadow DOM、1 个 iframe，回答仅在嵌套区域」的模拟页面、多层 Shadow DOM、同源 iframe 内流式回答和用户消息保护。后续真实页面检查确认，本次故障来自新版消息标记，详见 1.0.5。

## 1.0.4 扫描异常与诊断返回修复

- 修复扫描时把 SVG、MathML 元素传给 Chrome 的 HTMLElement 专用 Shadow DOM 接口的问题。单节点访问失败只记录错误计数，继续扫描其他节点。
- 诊断脚本先注册函数，再用 `executeScript({func})` 显式返回 JSON，不再依赖注入文件的完成值。
- 区分诊断文件加载失败、返回空值和运行时异常。错误包含阶段、异常类型与脱敏后的 API 错误信息，URL、UUID 和本地路径会被替换。注入失败时尝试补充页面引擎的诊断。
- 增加真实模块调用链的集成测试：运行实际弹窗、页面引擎和诊断代码，模拟 Chrome 文件注入不返回结果，验证初次注入、自动补注入、嵌套回答识别、诊断和批量展开。

该版本修复了可复现的扫描与诊断缺陷，后续通过真实页面检查定位到新版消息标记，详见 1.0.5。

## 1.0.5 真实 ChatGPT 页面适配

通过官方 Chrome DevTools MCP 连接用户已开启远程调试的 Chrome 后确认：当前 ChatGPT 使用 `h4[data-conversation-role]` 标记说话人，使用 `[data-turn-key]` / `[data-talvt-turn-state]` 容纳用户输入、推理、回答、操作栏及附属区域。旧选择器对应的 `article`、`data-message-author-role` 和 `.markdown` 在该页面均不存在。此前发现的跨域 sandbox iframe 并非本次识别故障的依据。

- 按新版角色与回合结构识别回答，不依赖构建生成的类名或用户正文。
- 同一回答可关联多个节点：一起收起推理、正文、回答操作栏及附属区域，完整保留用户消息和附件。
- 保留逐条与批量展开状态，新增的回答片段自动加入已有按钮。用户与回答共用的回合容器不会被整体隐藏。
- 跳过 `data-app-shell-active-page="false"` 的缓存页面，避免会话数量混入历史页面；监听页面切换和新标记变化。
- 诊断包含新版回合与角色计数。

**实际验证（2026-11-02）：** 在用户当前的两轮会话中，两个用户消息均保持可见，两次回答均有按钮且实际 `display:none`；独立展开第一条时第二条保持折叠，再次点击可收起；弹窗显示「2 次回答 · 2 次已收起」；批量展开和收起有效；关闭专注模式后所有回答恢复、按钮移除，重新开启后恢复折叠。没有发送测试问题，流式输出由自动测试覆盖。相关结构回归样本位于 `tests/fixtures/chatgpt-modern.html`，正文和标识均为合成内容。

## 使用 Chrome DevTools MCP 调试

开发依赖已包含官方 `chrome-devtools-mcp` 与 MCP SDK。Chrome 144+ 在 `chrome://inspect/#remote-debugging` 开启远程调试后，可通过 Codex 已配置的 `chrome-devtools` MCP 服务连接；首次连接由 Chrome 提示授权。

本项目还提供 `npm run debug:browser`，供当前会话通过 JSON 行调用同一个 MCP 服务。例如输入 `{"tool":"list_pages"}`。工具响应保存到忽略版本控制的 `artifacts/devtools-last-result.json`，不会打包到扩展中。该调试客户端只声明本项目为文件访问根目录，并关闭 MCP 使用统计。扩展运行本身仍不需要这些开发依赖。
