/**
 * Quote to chat — select text in a chat message, press "Add to chat", and the
 * excerpt lands as a removable quote card above the composer (like Codex). Your
 * own question stays a separate draft; the quote is prepended as a Markdown
 * blockquote only when you send.
 *
 * Plain ESM loaded uncompiled by Hermes Desktop: only `@hermes/plugin-sdk`,
 * `react` and `react/jsx-runtime` are importable, UI is `jsx()` calls.
 *
 * Surfaces used (all public SDK seams, no app patching):
 *  - a floating "Add to chat" button over any text selection outside an
 *    input (plain DOM on <body>, owned and disposed by this plugin; it never
 *    queries or restyles the app's own markup);
 *  - `composer.top` — the quote cards with an X each;
 *  - `composer.middleware` — prepends the quotes to an idle send;
 *  - while the agent is busy, Enter in the active composer (recognised by
 *    matching an editable's typed text with `host.composer.getDraft`) is
 *    routed through `host.composer.submit`, so a steer/queued follow-up
 *    carries the quote too.
 */

import { atom, Codicon, host, useValue } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

export const ID = 'hermes-quote-to-chat'

const EDITABLE = '[contenteditable="true"], [contenteditable=""], input, textarea'
const BUBBLE_ATTR = 'data-hermes-quote-bubble'
const MAX_CHARS = 6000
const REJECT_CHECK_MS = 2500

const STRINGS = {
  en: { add: 'Add to chat', remove: 'Remove quote', quote: 'Quote' },
  ru: { add: 'Добавить в чат', remove: 'Убрать цитату', quote: 'Цитата' }
}

/** Quotes waiting for the next send, keyed by stored session id ('new' = fresh draft). */
export const $quotes = atom({})

let t = key => STRINGS.en[key] ?? key

export const composerKey = () => host.state.focusedStoredSessionId.get() || 'new'

export const quotesFor = key => $quotes.get()[key] ?? []

export function setQuotes(key, list) {
  const next = { ...$quotes.get() }

  if (list.length) {
    next[key] = list
  } else {
    delete next[key]
  }

  $quotes.set(next)
}

export function addQuote(key, text) {
  const id = globalThis.crypto?.randomUUID?.() ?? `q-${Date.now()}-${Math.random().toString(36).slice(2)}`

  setQuotes(key, [...quotesFor(key), { id, text }])
}

export function removeQuote(key, id) {
  setQuotes(
    key,
    quotesFor(key).filter(quote => quote.id !== id)
  )
}

/** Quotes as Markdown blockquotes, then the user's own text. */
export function formatQuotes(quotes, text) {
  const blocks = quotes.map(quote =>
    quote.text
      .split('\n')
      .map(line => (line.trim() ? `> ${line}` : '>'))
      .join('\n')
  )

  return [...blocks, (text ?? '').trim()].filter(Boolean).join('\n\n')
}

const isSlashCommand = text => (text ?? '').trim().startsWith('/')

const elementOf = node => (node ? (node.nodeType === 1 ? node : node.parentElement) : null)

/** The current selection when it is real text outside any input or editable field. */
export function transcriptSelection(doc = document) {
  const selection = doc.getSelection?.()

  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null
  }

  const text = selection.toString().replace(/\u00a0/g, ' ').trim()

  if (!text) {
    return null
  }

  const anchor = elementOf(selection.anchorNode)
  const focus = elementOf(selection.focusNode)

  if (!anchor || !focus || anchor.closest(EDITABLE) || focus.closest(EDITABLE) || anchor.closest(`[${BUBBLE_ATTR}]`)) {
    return null
  }

  const range = selection.getRangeAt(0)
  const rects = typeof range.getClientRects === 'function' ? Array.from(range.getClientRects()) : []
  const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null

  return {
    text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text,
    first: rects[0] ?? box,
    last: rects[rects.length - 1] ?? box
  }
}

// ---------------------------------------------------------------------------
// The floating button. Plain DOM on <body>: the composer and transcript sit
// inside transformed containers, where position:fixed would not be viewport-
// relative, and runtime plugins cannot portal.
// ---------------------------------------------------------------------------

function createBubble(doc) {
  const button = doc.createElement('button')

  button.type = 'button'
  button.setAttribute(BUBBLE_ATTR, '')
  button.setAttribute('data-context-menu-skip', '')
  Object.assign(button.style, {
    position: 'fixed',
    zIndex: '2147483000',
    display: 'none',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 10px',
    borderRadius: '8px',
    border: '1px solid var(--ui-stroke-secondary)',
    background: 'var(--ui-bg-elevated)',
    color: 'var(--ui-text-primary)',
    font: 'inherit',
    fontSize: '12px',
    lineHeight: '16px',
    boxShadow: '0 6px 20px color-mix(in srgb, var(--ui-text-primary) 18%, transparent)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none'
  })

  const icon = doc.createElement('span')

  icon.className = 'codicon codicon-quote'
  icon.setAttribute('aria-hidden', 'true')

  const label = doc.createElement('span')

  label.textContent = t('add')
  button.append(icon, label)
  doc.body.append(button)

  return { button, label }
}

function placeBubble(button, found, view) {
  button.style.display = 'inline-flex'

  const width = button.offsetWidth || 130
  const height = button.offsetHeight || 28
  const gap = 6
  const anchor = found.last ?? found.first

  if (!anchor) {
    button.style.left = `${Math.max(8, view.innerWidth / 2 - width / 2)}px`
    button.style.top = `${Math.max(8, view.innerHeight / 2)}px`

    return
  }

  let top = anchor.bottom + gap

  if (top + height > view.innerHeight - 8 && found.first) {
    top = found.first.top - height - gap
  }

  const left = Math.min(Math.max(8, anchor.right - width), view.innerWidth - width - 8)

  button.style.left = `${left}px`
  button.style.top = `${Math.max(8, top)}px`
}

// ---------------------------------------------------------------------------
// Composer card
// ---------------------------------------------------------------------------

export function QuoteCards() {
  const all = useValue($quotes)
  const key = useValue(host.state.focusedStoredSessionId) || 'new'
  const list = all[key] ?? []

  if (!list.length) {
    return null
  }

  return jsx('div', {
    className: 'flex w-full flex-col gap-1.5 pb-1',
    'data-quote-to-chat': 'cards',
    children: list.map(quote =>
      jsxs(
        'div',
        {
          className:
            'flex w-full items-start gap-2 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-quinary) px-2.5 py-1.5',
          'data-quote-to-chat': 'card',
          children: [
            jsx(Codicon, { className: 'mt-0.5 shrink-0 text-(--ui-text-tertiary)', name: 'quote', size: '0.8rem' }),
            jsx('div', {
              className: 'min-w-0 flex-1 text-xs text-(--ui-text-secondary)',
              style: {
                display: '-webkit-box',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
                whiteSpace: 'pre-wrap',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 3
              },
              title: quote.text,
              children: quote.text
            }),
            jsx('button', {
              'aria-label': t('remove'),
              className:
                'grid size-5 shrink-0 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground',
              onClick: () => removeQuote(key, quote.id),
              title: t('remove'),
              type: 'button',
              children: jsx(Codicon, { name: 'close', size: '0.75rem' })
            })
          ]
        },
        quote.id
      )
    )
  })
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** Idle send: prepend this composer's quotes. A rejected send restores the draft
 *  text in the composer, so give its quotes back too. */
export function makeMiddleware(schedule) {
  return {
    handler: draft => {
      const key = composerKey()
      const list = quotesFor(key)

      if (!list.length || isSlashCommand(draft?.text)) {
        return draft
      }

      const text = draft?.text ?? ''

      setQuotes(key, [])

      if (text.trim()) {
        schedule(async () => {
          if (quotesFor(key).length) {
            return
          }

          const back = await Promise.resolve(host.composer.getDraft(null)).catch(() => null)

          if (typeof back === 'string' && back.trim() === text.trim()) {
            setQuotes(key, list)
          }
        }, REJECT_CHECK_MS)
      }

      return { ...draft, text: formatQuotes(list, text) }
    }
  }
}

const editableText = el => (el?.innerText ?? el?.textContent ?? '').trim()

// The rich-text root the user is typing in (generic contenteditable, not app markup).
const editableRoot = target => {
  const el = elementOf(target)

  return el?.closest?.('[contenteditable="true"], [contenteditable=""]') ?? null
}

/** Learns which editables are composers without touching app markup: after
 *  typing, an editable whose text equals the SDK's live draft is the active
 *  composer. */
export function makeComposerTracker(composers) {
  return event => {
    const el = editableRoot(event.target)

    if (!el || composers.has(el)) {
      return
    }

    void Promise.resolve(host.composer.getDraft(null))
      .then(draft => {
        if (typeof draft === 'string' && draft.trim() && draft.trim() === editableText(el)) {
          composers.add(el)
        }
      })
      .catch(() => {})
  }
}

/** Busy send: the composer steers/queues a busy Enter without the middleware,
 *  so route it through the SDK's submit (which steers or queues the same way). */
export function makeBusyEnterHandler(composers) {
  return event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.defaultPrevented) {
      return
    }

    const input = editableRoot(event.target)

    if (!input || !composers.has(input) || !host.state.busy.get()) {
      return
    }

    const key = composerKey()
    const list = quotesFor(key)
    const typed = editableText(input)

    if (!list.length || !typed || isSlashCommand(typed)) {
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    void (async () => {
      const draft = (await Promise.resolve(host.composer.getDraft(null)).catch(() => null)) ?? typed
      const combined = formatQuotes(list, draft)

      if (host.composer.submit(null, combined)) {
        setQuotes(key, [])
        await Promise.resolve(host.composer.setDraft(null, '')).catch(() => false)
      }
    })()
  }
}

// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Quote to chat',
  description: 'Select text → "Add to chat" → a removable quote card above the input, sent with your next message.',
  register(ctx) {
    const doc = document
    const view = window

    if (ctx.i18n?.register && ctx.i18n?.t) {
      ctx.i18n.register(STRINGS)
      t = key => ctx.i18n.t(key)
    }

    const { button, label } = createBubble(doc)
    let pending = null

    const hide = () => {
      pending = null
      button.style.display = 'none'
    }

    const refresh = () => {
      const found = transcriptSelection(doc)

      if (!found) {
        hide()

        return
      }

      pending = found
      label.textContent = t('add')
      placeBubble(button, found, view)
    }

    const add = () => {
      const found = pending ?? transcriptSelection(doc)

      if (!found) {
        hide()

        return
      }

      addQuote(composerKey(), found.text)
      doc.getSelection?.()?.removeAllRanges()
      hide()
      host.composer.focus(null)
    }

    // Act on mousedown and keep the selection alive: a click would first
    // collapse the selection the button is about.
    ctx.addEventListener(button, 'mousedown', event => {
      event.preventDefault()
      event.stopPropagation()
      add()
    })
    ctx.addEventListener(button, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        add()
      }
    })

    const later = () => ctx.setTimeout(refresh, 0)

    ctx.addEventListener(doc, 'mouseup', later)
    ctx.addEventListener(doc, 'keyup', event => {
      if (event.shiftKey || event.key === 'Shift' || ((event.metaKey || event.ctrlKey) && event.key === 'a')) {
        later()
      }
    })
    ctx.addEventListener(doc, 'selectionchange', () => {
      if (button.style.display !== 'none' && !transcriptSelection(doc)) {
        hide()
      }
    })
    ctx.addEventListener(
      doc,
      'mousedown',
      event => {
        if (!event.target?.closest?.(`[${BUBBLE_ATTR}]`)) {
          hide()
        }
      },
      true
    )
    ctx.addEventListener(doc, 'scroll', hide, true)
    ctx.addEventListener(view, 'resize', hide)
    ctx.addEventListener(view, 'blur', hide)
    ctx.addEventListener(doc, 'keydown', event => {
      if (event.key === 'Escape') {
        hide()
      }
    })
    const composers = new WeakSet()

    ctx.addEventListener(doc, 'input', makeComposerTracker(composers), true)
    ctx.addEventListener(doc, 'keydown', makeBusyEnterHandler(composers), true)

    ctx.register({ id: 'cards', area: 'composer.top', order: -100, render: () => jsx(QuoteCards, {}) })
    ctx.register({ id: 'middleware', area: 'composer.middleware', data: makeMiddleware((fn, ms) => ctx.setTimeout(fn, ms)) })

    ctx.onDispose(() => {
      button.remove()
      $quotes.set({})
    })
  }
}
