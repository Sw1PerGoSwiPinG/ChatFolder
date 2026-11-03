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

## User input folding

User inputs longer than the configured rendered line limit are collapsed by
default. The default limit is 1 line. The popup has an independent input-folding
switch, a positive integer line limit and separate input bulk actions. Pausing
answer folding does not pause input folding. Editable drafts are excluded.

The browser's native line clamp determines the displayed lines. Full and clamped
heights determine overflow, including soft wrapping, explicit newlines, inline
markup and padding. Width changes, font loading and content changes trigger a
new measurement. Content-box overflow clipping prevents the bubble's bottom
padding from revealing part of the next line. Disabling input folding restores
the original element styles.

The jsdom tests cover controller state and mocked geometry. For real Chrome
layout checks, run `npm run build` and `npm run test:browser-fixture`, then open
`http://127.0.0.1:29848/tests/fixtures/user-folding.html` and optionally
`http://127.0.0.1:29848/popup/popup.html`. This local-only server supplies mock
Chrome messaging/storage while running the production scripts. It uses
synthetic prompts, never a real conversation. Evaluate the exported
`runUserFoldingChecks` function from `tests/browser/user-folding-checks.mts`
in the fixture page via Chrome DevTools MCP to check actual rendered geometry,
resizing, content edits and style restoration.
