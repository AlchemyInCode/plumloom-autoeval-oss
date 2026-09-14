# DeepSeek Harness test fixtures

`session.jsonl` and `template.json` are hand-written fixtures for the mapping
rules described in `packages/cli/src/trace/deepseek-harness.ts`.

`real-web-search-session.jsonl` and `real-tool-failure-session.jsonl` are
**unmodified** session logs copied from the DeepSeek Harness snapshot suite:

| Fixture                           | Upstream path                                      |
| --------------------------------- | -------------------------------------------------- |
| `real-web-search-session.jsonl`   | `snapshots/web/web-search-round/session.jsonl`     |
| `real-tool-failure-session.jsonl` | `snapshots/session/fs-policy-reject/session.jsonl` |

Source: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness),
licensed MIT (Copyright (c) 2026 DeepSeek). The complete upstream license and
notice are preserved in [`LICENSE`](./LICENSE). The `{{...}}` placeholders are
the snapshot suite's own redactions of machine-specific values.

They are vendored because the hand-written fixture did not reflect how the
Harness actually writes a log, and the converter silently produced a degraded
trace against real data. Real logs pin these behaviours:

- the session header is a typed `session` event, not a bare leading object;
- no event carries a timestamp — only the header's `createdAt` does;
- a `tool/result` names its call under `message.source.callId` and on each
  `tool-result` content part, never at the top level;
- `tool-result` text nests one content level deeper than other parts;
- an assistant turn that invokes a tool has no text content at all;
- the Harness injects plugin-authored runtime-context messages with
  `role: "user"`, which are not the developer's prompt.

Refresh them only by re-copying from an upstream snapshot, never by editing in
place — an edited fixture stops being evidence of the real format.
