# Chrome Web Store Listing — ChatFolder

> Last Updated: 2026-11-14
> Status: Draft; not submitted to the Chrome Web Store.

## Store Listing

**Extension Name:** ChatFolder

**Short Description:** 收起 ChatGPT 回答和用户输入，记住折叠状态，让长对话更易浏览。

**Detailed Description:**

ChatFolder 帮助你按需展开或收起 ChatGPT 的回答和用户输入。

支持自动收起新回答、独立控制输入与回答折叠、设置输入保留行数，以及分别执行批量操作。折叠选择保存在本机，再次打开会话时自动恢复。

滚动浏览时会记住已识别的消息，数量不会因消息滚出屏幕而下降。点击“校验会话”可临时遍历当前会话，更新数量和顺序；校验期间滚动或按 Esc 可中止。未完成校验时会明确标注缓存或已识别数量，批量操作只作用于已识别消息。

安装后打开 ChatGPT，在工具栏打开 ChatFolder 管理设置，也可以点击每条消息旁的按钮。

所有记录留在当前浏览器配置中，不上传、不跨设备同步。反馈：https://github.com/Sw1PerGoSwiPinG/ChatFolder/issues

**Category:** Productivity

**Single Purpose:** 折叠 ChatGPT 对话消息，让长会话更易浏览。

**Primary Language:** Chinese (Simplified)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store icon | 128×128 PNG | Not created | — |
| Screenshot 1 | 1280×800 or 640×400 | Needs store-sized export | docs/images/before.png |
| Screenshot 2 | 1280×800 or 640×400 | Needs update for index/verification UI | docs/images/after.png |
| Small promo tile | 440×280 | Not created | — |

### Screenshot Notes

Show expanded/collapsed conversation views and the cache/verification controls. Existing README screenshots are illustrations, not submission-ready store assets.

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| storage | permissions | Keep fold choices, settings and a message identifier index on this device so conversations restore their state after reopening. |
| activeTab | permissions | Connect the popup to the ChatGPT tab the user is currently managing. |
| scripting | permissions | Restore the extension's page controls on an already-open ChatGPT tab after installation or update. |
| https://chatgpt.com/* and https://chat.openai.com/* | content_scripts matches | Find conversation messages and add folding controls only on supported ChatGPT pages. |

No host_permissions, remote code, analytics or backend service are used.

## Privacy & Data Use

**Data handling:** Local processing only; no data is transmitted off-device by the extension.

| Data Type | Processed / Stored Locally | Transmitted Off-Device | Purpose | Shared |
|---|---|---|---|---|
| Conversation and message identifiers | Yes | No | Separate local conversation indexes and fold choices | No |
| User activity | Fold choices, index order and verification time only | No | Restore state and distinguish verified counts from partial caches | No |
| Website content | DOM structure processed to identify messages; bodies are not stored | No | Add folding controls and verify the current message directory | No |
| Authentication, location, financial or health data | Not collected intentionally; no content extraction or storage | No | None | No |

Records are stored in the current Chrome profile and removed on uninstall. Verification scrolls the current page only when explicitly requested, can be cancelled, and does not send messages or change conversation content. Normal website requests triggered by browsing remain the website's responsibility.

### Data Use Certification

- [x] Data is NOT sold to third parties.
- [x] Data is NOT used for purposes unrelated to the extension's core functionality.
- [x] Data is NOT used for creditworthiness or lending purposes.

## Privacy Policy

**Privacy Policy URL:** Not yet provided; required before store submission. This document describes current local data handling but is not a published privacy policy.

## Distribution

**Visibility:** Planned public; currently distributed as source on GitHub.

**Regions:** To be selected before store submission.

## Developer Info

**Publisher Name:** To be confirmed before submission.

**Contact Email:** To be provided before submission.

**Support URL:** https://github.com/Sw1PerGoSwiPinG/ChatFolder/issues

**Homepage:** https://github.com/Sw1PerGoSwiPinG/ChatFolder

## Version History

| Version | Date | Changes | Status |
|---|---|---|---|
| 1.4.0 | 2026-11-14 | Persistent message index, virtualization-compatible counts and bulk operations, cancellable conversation verification | Draft |
| 1.3.0 | 2026-11-09 | Local per-message fold state restoration | GitHub only |

## Review Notes

### Known Issues / Limitations

An unverified index is not an authoritative conversation total. Virtualized messages require browsing or explicit verification to discover them. Branch changes/deletions are reconciled by a successful complete verification; partial scans never delete cached entries. Verification is bounded, cancels on user input/navigation, and declines to certify unstable layouts, active generation or unidentified messages. Store icon, store-sized screenshots, public privacy policy and publisher contact details remain pending. Submission ZIP must exclude development dependencies, Git history, local artifacts and this listing document.

### Rejection History

None; no store submission has been made.
