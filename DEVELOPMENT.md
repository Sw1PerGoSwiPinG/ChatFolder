# Development

Requirements: Node.js 22.12+ and Chrome.

```sh
npm ci
npm run build
npm run check
npm test
```

Load the repository root with Chrome's **Load unpacked** action at
`chrome://extensions`. The manifest runs the JavaScript compiled to `build/`;
TypeScript sources live in `content/` and `popup/`. After changing a source file,
run `npm run build`, reload the extension, and refresh the ChatGPT tab.

`build/` is generated and excluded from Git. Tests run the compiled scripts in
jsdom, including a synthetic fixture based on the current ChatGPT DOM.

To create a ZIP on Windows, run the build first, then:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Compress-Archive -Path manifest.json,build,content,popup -DestinationPath dist/ChatFolder.zip -Force
```

For Chrome DevTools MCP debugging, enable remote debugging in Chrome and run
`npm run debug:browser`. The development client accepts tool requests as JSON
lines. Its output is stored only in the ignored `artifacts/` directory.
