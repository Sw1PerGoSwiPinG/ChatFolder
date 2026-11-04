# ChatFolder

一款 Chrome 浏览器扩展，收起 ChatGPT 的长篇回答和用户输入，让长对话更易浏览。

## 功能

- **回答折叠**：逐条展开或收起回答，支持自动收起新回答及一键全部收起 / 展开。
- **输入折叠**：每条已发送的用户消息下方显示折叠拉手，点击后只保留指定行数，默认为 1 行。默认完整显示，不影响未发送的草稿。
- **独立控制**：回答与输入折叠可分别启停，并分别执行批量操作。
- **本地处理**：不上传聊天内容，支持浅色与深色界面。

目前支持 ChatGPT（`chatgpt.com`、`chat.openai.com`），预留 Gemini、DeepSeek 等厂商的适配接口。

## 效果对比

### 折叠前

![回答和用户输入完整展开](docs/images/before.png)

### 折叠后

![回答收起、用户输入保留一行，按需展开](docs/images/after.png)

## 安装

需要 Chrome 和 Node.js 22.12 或更高版本。

1. 克隆项目并编译：

   ```sh
   git clone https://github.com/Sw1PerGoSwiPinG/ChatFolder.git
   cd ChatFolder
   npm ci
   npm run build
   ```

2. 在 Chrome 地址栏打开 `chrome://extensions`，开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目根目录（包含 `manifest.json` 的目录）。
4. 打开或刷新 ChatGPT 页面，点击 Chrome 工具栏中的 ChatFolder 图标。

## 使用

- **管理回答**：开启「折叠 AI 回答」，点击页面中的回答按钮逐条展开 / 收起，或在插件中点击「全部收起 / 全部展开」。开启「自动收起新回答」后，新回答会自动收起。
- **管理输入**：开启「折叠用户输入」，设置「收起后显示」的行数。点击消息下方的拉手即可收起 / 展开；下方的「全部收起 / 全部展开」只作用于用户输入。短消息也会显示拉手，收起后不会强行补足行数。
- **更新插件**：拉取最新代码后运行 `npm run build`，在扩展管理页重新加载 ChatFolder，再刷新 ChatGPT 页面。刷新前请保存未发送的草稿。

开发与测试说明见 [DEVELOPMENT.md](DEVELOPMENT.md)。
