# Quote to Chat

Codex-style quoting for **Hermes Desktop**.

Select any text outside an input — an agent reply, your own earlier message, a tool output — and press **Add to chat**. The excerpt becomes a quote card above the composer. Type your question as usual; when you send, the quotes go in front of it as Markdown blockquotes, once.

```
> the exact sentence you selected

what does this mean for the migration?
```

## Why

Asking about one specific sentence of a long reply normally means copy, paste, add `>` by hand, and hope the agent notices which part you meant. Quote to Chat keeps the quote and your question apart until you send, so you can collect several quotes, remove one with its ×, and edit your question freely.

## How it differs from Quote & Ask

[`quote-ask`](https://github.com/freefate258/quote-ask) pastes the selection into your draft as text. Quote to Chat keeps quotes as separate, removable cards and merges them only at send time (`composer.middleware`), so:

- your draft is never edited, and several quotes can be collected and removed one by one;
- quotes are scoped to the chat they were taken in;
- a busy-agent send and a rejected send keep the quote attached to the question.

## Behaviour

- **Per chat.** Quotes belong to the chat you added them in; switching chats never leaks a quote into another conversation.
- **Several quotes.** Add as many as you like; each card has its own ×.
- **Sent once.** Quotes are cleared after a send. Nothing is ever sent automatically.
- **Busy agent.** If the agent is still working, Enter sends quote + question through the same steer/queue path the composer uses.
- **Rejected send.** If the app restores your draft after a failed send, the quotes come back too.
- **Slash commands** (`/status`, …) are never wrapped.
- English and Russian UI.

## Install

Plugin catalog (once listed):

```
hermes plugins install hermes-quote-to-chat
```

Or from Git: Desktop → Capabilities → Plugins → **Install from Git** → `https://github.com/ivanvanes18/hermes-quote-to-chat`.

Or by hand: copy `desktop/plugin.js` to `~/.hermes/desktop-plugins/hermes-quote-to-chat/plugin.js`, then ⌘K → **Reload desktop plugins**.

## How it works

One file, `desktop/plugin.js`, plain ESM loaded uncompiled, importing only `@hermes/plugin-sdk` and `react/jsx-runtime`:

| Piece | SDK surface |
|---|---|
| Quote cards with × | `composer.top` slot |
| Prepending quotes on send | `composer.middleware` |
| Busy-agent send | `host.composer.getDraft` / `host.composer.submit` |
| Per-chat scoping | `host.state.focusedStoredSessionId` |
| Listeners, timers, cleanup | `ctx.addEventListener`, `ctx.setTimeout`, `ctx.onDispose` |

The floating button is the plugin's own element on `<body>`; the plugin never queries, restyles or clicks the app's markup. `hermes plugins validate` passes, including the `desktop surface` check.

## Disclosure

No network calls, no agent tools/hooks/middleware, no env vars, no credentials, no files read or written. Quotes live in memory only and are dropped when the plugin is disabled.

## Tests

```
QTC_NODE_MODULES=/path/to/node_modules node test/run.mjs   # needs jsdom + nanostores
```

16 behaviour tests on a jsdom page with a fake SDK: selection, cards, ×, per-chat scope, send, rejected send, busy send, slash commands, cleanup, and a guard that the source never selects app markup.

## License

MIT
