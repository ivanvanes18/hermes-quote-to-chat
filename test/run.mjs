// Behaviour tests for plugin.js against a jsdom document and a minimal fake of
// the SDK surface the plugin uses. Run: node test/run.mjs
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const NODE_MODULES = process.env.QTC_NODE_MODULES
const require = createRequire(path.join(NODE_MODULES, 'x.js'))
const { JSDOM } = require('jsdom')
const { atom } = require('nanostores')

const dom = new JSDOM(`<!doctype html><body>
  <div data-slot="aui_thread-viewport"><div data-slot="aui_assistant-message-root"><p id="msg">Hermes удалён для установки с нуля: приложение, движок.</p></div></div>
  <div data-slot="composer-root"><div data-slot="composer-rich-input" contenteditable="true" id="input"></div></div>
  <p id="outside">outside text</p>
</body>`, { pretendToBeVisual: true })

globalThis.window = dom.window
globalThis.document = dom.window.document

// --- fake SDK ---------------------------------------------------------------
const state = { focusedStoredSessionId: atom('sess-A'), busy: atom(false) }
const calls = { submit: [], setDraft: [], focus: 0 }
let draft = ''
let submitAccepts = true
const host = {
  state,
  composer: {
    getDraft: async () => draft,
    setDraft: async (_s, text) => { calls.setDraft.push(text); draft = text; return true },
    submit: (_s, text) => { calls.submit.push(text); return submitAccepts },
    focus: () => { calls.focus += 1 }
  }
}
const sdkPath = path.join(here, '.sdk-shim.mjs')
const jsxPath = path.join(here, '.jsx-shim.mjs')
globalThis.__QTC_SDK__ = { host, atom, useValue: a => a.get(), Codicon: props => ({ type: 'Codicon', props }) }
await writeFile(sdkPath, 'const s = globalThis.__QTC_SDK__; export const host = s.host, atom = s.atom, useValue = s.useValue, Codicon = s.Codicon\n')
await writeFile(jsxPath, 'export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx\n')
const source = (await readFile(path.join(root, 'plugin.js'), 'utf8'))
  .replace("'@hermes/plugin-sdk'", JSON.stringify(pathToFileURL(sdkPath).href))
  .replace("'react/jsx-runtime'", JSON.stringify(pathToFileURL(jsxPath).href))
const modPath = path.join(here, '.plugin-under-test.mjs')
await writeFile(modPath, source)
const mod = await import(pathToFileURL(modPath).href)
const plugin = mod.default

// --- fake ctx ---------------------------------------------------------------
const registrations = []
const disposers = []
const timers = []
const ctx = {
  register: c => { registrations.push(c); return () => {} },
  addEventListener: (target, type, fn, opts) => { target.addEventListener(type, fn, opts); disposers.push(() => target.removeEventListener(type, fn, opts)) },
  setTimeout: (fn, ms) => { timers.push({ fn, ms }); return () => {} },
  onDispose: fn => disposers.push(fn),
  i18n: { register: () => {}, t: key => ({ add: 'Добавить в чат', remove: 'Убрать цитату' })[key] ?? key }
}
const flushTimers = async () => { while (timers.length) { const t = timers.shift(); await t.fn() } }

let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log('PASS', name) }

const select = (node, start = 0, end = node.textContent.length) => {
  const range = document.createRange()
  range.setStart(node.firstChild, start)
  range.setEnd(node.firstChild, end)
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(range)
}
const bubble = () => document.querySelector('[data-hermes-quote-bubble]')
const mouseup = () => document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))

plugin.register(ctx)
const middleware = registrations.find(r => r.area === 'composer.middleware').data
const cards = registrations.find(r => r.area === 'composer.top')

await test('registers card slot above input and send middleware', () => {
  assert.equal(cards.order, -100)
  assert.equal(typeof cards.render, 'function')
  assert.equal(typeof middleware.handler, 'function')
  assert.ok(bubble(), 'bubble element created')
  assert.equal(bubble().style.display, 'none')
})

await test('selection inside transcript shows «Добавить в чат»', async () => {
  select(document.getElementById('msg'), 0, 6)
  mouseup()
  await flushTimers()
  assert.equal(bubble().style.display, 'inline-flex')
  assert.match(bubble().textContent, /Добавить в чат/)
})

await test('selection outside transcript or in the input shows nothing', async () => {
  select(document.getElementById('outside'))
  mouseup(); await flushTimers()
  assert.equal(bubble().style.display, 'none')
  const input = document.getElementById('input')
  input.textContent = 'my draft'
  select(input)
  mouseup(); await flushTimers()
  assert.equal(bubble().style.display, 'none')
  input.textContent = ''
})

await test('clicking the button adds a quote card for the focused session, keeps the draft', async () => {
  draft = 'мой черновик'
  select(document.getElementById('msg'), 0, 6)
  mouseup(); await flushTimers()
  bubble().dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  assert.deepEqual(mod.quotesFor('sess-A').map(q => q.text), ['Hermes'])
  assert.equal(bubble().style.display, 'none')
  assert.equal(document.getSelection().rangeCount, 0)
  assert.equal(calls.focus, 1)
  assert.equal(draft, 'мой черновик', 'draft untouched')
  assert.equal(calls.setDraft.length, 0)
})

await test('card renders excerpt with an X that removes only that quote', () => {
  mod.addQuote('sess-A', 'вторая')
  const tree = mod.QuoteCards()
  const rows = tree.props.children
  assert.equal(rows.length, 2)
  const [first] = rows
  assert.equal(first.props.children[1].props.children, 'Hermes')
  first.props.children[2].props.onClick()
  assert.deepEqual(mod.quotesFor('sess-A').map(q => q.text), ['вторая'])
  mod.setQuotes('sess-A', [])
  assert.equal(mod.QuoteCards(), null)
})

await test('quotes are per session; switching session hides them and sends nothing extra', async () => {
  mod.addQuote('sess-A', 'цитата A')
  state.focusedStoredSessionId.set('sess-B')
  assert.equal(mod.QuoteCards(), null)
  const out = await middleware.handler({ text: 'вопрос B' })
  assert.equal(out.text, 'вопрос B')
  assert.deepEqual(mod.quotesFor('sess-A').map(q => q.text), ['цитата A'])
  state.focusedStoredSessionId.set('sess-A')
})

await test('idle send prepends quote as blockquote once, then clears', async () => {
  draft = ''
  const out = await middleware.handler({ text: 'что это значит?', attachments: [{ id: 'f' }] })
  assert.equal(out.text, '> цитата A\n\nчто это значит?')
  assert.deepEqual(out.attachments, [{ id: 'f' }])
  assert.equal(mod.quotesFor('sess-A').length, 0)
  const again = await middleware.handler({ text: 'следующее' })
  assert.equal(again.text, 'следующее', 'no second injection')
  await flushTimers()
  assert.equal(mod.quotesFor('sess-A').length, 0, 'accepted send: draft not restored → quote stays cleared')
})

await test('multi-line quote keeps every line quoted; quote-only send works', () => {
  assert.equal(mod.formatQuotes([{ text: 'a\n\nb' }], ''), '> a\n>\n> b')
})

await test('rejected send gives the quote back when composer restores the text', async () => {
  mod.addQuote('sess-A', 'вернуть')
  await middleware.handler({ text: 'вопрос' })
  draft = 'вопрос'
  await flushTimers()
  assert.deepEqual(mod.quotesFor('sess-A').map(q => q.text), ['вернуть'])
  mod.setQuotes('sess-A', [])
  draft = ''
})

await test('slash commands are never wrapped', async () => {
  mod.addQuote('sess-A', 'q')
  const out = await middleware.handler({ text: '/status' })
  assert.equal(out.text, '/status')
  assert.equal(mod.quotesFor('sess-A').length, 1)
  mod.setQuotes('sess-A', [])
})

await test('busy Enter routes quote + question through host.composer.submit', async () => {
  const input = document.getElementById('input')
  input.textContent = 'уточнение'
  draft = 'уточнение'
  mod.addQuote('sess-A', 'контекст')
  state.busy.set(true)
  const ev = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  input.dispatchEvent(ev)
  assert.equal(ev.defaultPrevented, true)
  await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(calls.submit, ['> контекст\n\nуточнение'])
  assert.equal(mod.quotesFor('sess-A').length, 0)
  assert.equal(calls.setDraft.at(-1), '')
})

await test('busy Enter without quotes or with Shift is left to the app', () => {
  const input = document.getElementById('input')
  input.textContent = 'x'
  const plain = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  input.dispatchEvent(plain)
  assert.equal(plain.defaultPrevented, false)
  mod.addQuote('sess-A', 'q')
  const shift = new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
  input.dispatchEvent(shift)
  assert.equal(shift.defaultPrevented, false)
  state.busy.set(false)
  const idle = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  input.dispatchEvent(idle)
  assert.equal(idle.defaultPrevented, false, 'idle Enter goes through the middleware path instead')
  mod.setQuotes('sess-A', [])
})

await test('busy submit refused keeps quote and draft', async () => {
  const input = document.getElementById('input')
  input.textContent = 'y'; draft = 'y'
  mod.addQuote('sess-A', 'keep')
  state.busy.set(true)
  submitAccepts = false
  const before = calls.setDraft.length
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await new Promise(r => setTimeout(r, 10))
  assert.equal(mod.quotesFor('sess-A').length, 1)
  assert.equal(calls.setDraft.length, before)
  submitAccepts = true; state.busy.set(false); mod.setQuotes('sess-A', [])
})

await test('dispose removes the button and all listeners', async () => {
  disposers.forEach(fn => fn())
  assert.equal(bubble(), null)
  select(document.getElementById('msg'))
  mouseup(); await flushTimers()
  assert.equal(bubble(), null)
})

await rm(sdkPath); await rm(jsxPath); await rm(modPath)
console.log(`\n${passed} passed`)
