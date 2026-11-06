# Quote to chat — Hermes Desktop plugin

Select text in a chat message → **«Добавить в чат»** → the excerpt appears as a removable quote card above the input. Your own question stays a separate draft. On send, the quotes are prepended as Markdown blockquotes, once. Nothing is sent automatically.

- Desktop-only plugin (`plugin.js`), loaded uncompiled through the public `@hermes/plugin-sdk`; no app source patch, so it survives app updates.
- Quotes are kept per chat; switching chats never leaks a quote into another one.
- While the agent is busy, Enter sends quote + question through the SDK's steer/queue path.
- A rejected send gives the quote back together with the restored draft. Slash commands are never wrapped.

Install: `hermes://plugin-desktop/install?repo=<this repo URL>`, or put `plugin.js` into `~/.hermes/desktop-plugins/hermes-quote-to-chat/` and run ⌘K → Reload desktop plugins.

Tests: `QTC_NODE_MODULES=<dir with jsdom and nanostores> node test/run.mjs`.
