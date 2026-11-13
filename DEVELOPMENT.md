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

Every sent user input has a low-profile drawer button below the bubble,
including short messages. Inputs without saved state start expanded; clicking the drawer collapses
an input to at most the configured rendered line limit (default: 1). The popup
has an independent toggle, a positive integer line limit and input bulk actions.
Editable drafts and inactive cached pages are excluded.

Native line clamping is combined with a height cap based on the text's computed
line height and bubble padding/borders. The height cap also handles ChatGPT's
nested block/flex message structure, where native line clamping alone has no
effect. Short inputs keep their natural height. Controls never depend on overflow
detection. Width, font and content changes refresh measurements. Disabling input
folding restores original styles.

The jsdom tests cover controller state and mocked geometry. For real Chrome
layout checks, run `npm run build` and `npm run test:browser-fixture`, then open
`http://127.0.0.1:29848/tests/fixtures/user-folding.html` and optionally
`http://127.0.0.1:29848/popup/popup.html`. This local-only server supplies mock
Chrome messaging/storage while running the production scripts. It uses
synthetic prompts, never a real conversation. Evaluate the exported
`runUserFoldingChecks` function from `tests/browser/user-folding-checks.mts`
in the fixture page via Chrome DevTools MCP to check actual rendered geometry,
resizing, content edits and style restoration.

## Local fold history

`content/history.ts` stores versioned, per-message boolean entries in
`chrome.storage.local`. Keys contain provider, conversation ID, message kind and
stable message ID. No text, titles or query parameters are stored. ChatGPT
ordinary and project conversation URLs share the same `/c/:id` identity.

The engine waits for hydration before rendering or handling popup commands.
Initial states and individual/bulk changes are saved; stored states override
defaults. Writes are serialized and grouped, with separate entries preventing
unrelated messages in different tabs from overwriting each other. Storage change
events update open tabs. Disabling folding restores the page without deleting
history. Storage errors fall back to in-memory folding. Anonymous conversations
and messages without stable IDs are not persisted; positional turn selectors
are deliberately excluded. History stays in the Chrome profile and is removed
when the extension is uninstalled.

## Virtualized conversation catalog

`content/catalog.ts` maintains an ID-only directory independent of mounted DOM
records. Discovery writes one versioned entry per message, so concurrent tabs do
not overwrite unrelated message memberships. Old boolean fold records seed a
partial index. Ordering is provisional until a successful current-branch sweep;
verified snapshots replace obsolete membership while preserving saved fold
choices. Nodes leaving the DOM never remove catalog entries. New IDs invalidate
completeness, and verification expires after five minutes. Snapshot timestamps
are ordered after discovery timestamps to prevent deleted-branch IDs resurfacing.

`content/verify.ts` runs only on explicit request. It temporarily expands mounted
targets without changing choices, suspends engine rendering, walks overlapping
viewports, collects stable IDs and requires stable start/end coverage. It refuses
to certify missing scrollers, anonymous messages, streaming turns, layout jumps,
user interruption, navigation, timeouts or traversal limits. Partial scans add IDs
but never prune. User wheel/touch/pointer/navigation keys interrupt; explicit
cancellation restores the original scroll offset, while direct page input keeps
the user's new position. No internal ChatGPT API or React state is accessed.

The popup distinguishes known/cached counts from verified counts. Bulk operations
write states for the entire known directory, and later remounts restore them;
new messages retain their defaults. Own storage notifications and style-only
virtualizer movement do not trigger full reconciliation; scope discovery polling
runs every two seconds to cover shadow roots and frames. Counts come from the
local index instead of a DOM scan. The engine still scans mounted structure when
meaningful content changes occur.

For real rendered virtualization tests, serve `npm run test:browser-fixture`, open
`http://127.0.0.1:29848/c/virtual-<unique-name>`, and evaluate `runCatalogChecks`
from `tests/browser/catalog-checks.mts`. The fixture contains six turns but mounts
only two. Reload and evaluate `checkCatalogReload` to verify persistence. The
server uses synthetic messages and mocked Chrome storage/messaging.
