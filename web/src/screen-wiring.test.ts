import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CustomerSchema, QuoteItemSchema, QuoteSchema, TermsSchema, type Quote } from '@shared/schema'
import {
  DOCUMENT_FIELDS,
  NOT_COMPARED,
  changeLabels,
  chooseRef,
  documentChanges,
  downloadCurrent,
  type DocumentField,
  type EditorItem,
  type QuoteDraft,
} from './pages/QuoteEditor'

/**
 * The points where a screen hands on work something else did for it.
 *
 * Both went quiet at the same time. The document grew a GSTIN line while the
 * editor was still building its preview from a fixed list of three customer
 * fields, so the downloaded file printed a number the screen above it did not
 * — and the preview is supposed to be the document, paragraph for paragraph.
 * Meanwhile `itemsFromLines` began fetching a quantity off the customer's own
 * request line, and the screen destructured everything it returned except the
 * warnings that say so, so a changed quantity reached the quotation unsaid.
 *
 * Neither failed a type check: a dropped property on an object literal and an
 * ignored field of a return value both compile.
 *
 * The warranty made a third of it. It is read out of the line descriptions and
 * handed on three ways at once — the term to print, the descriptions with the
 * text taken out of them, and the warnings for standing one line's promise over
 * the whole document — while a saved quote's terms are handed to the draft
 * whole, so a term the draft type never names is dropped by the assignment
 * itself.
 *
 * The reference number is a fourth, and a seam of a different kind: not a field
 * dropped on the way through but two answers to one question. The desk can now
 * choose the number, and that one number has to reach the document beside the
 * form AND the save request — show one and claim the other, and a quotation goes
 * out under a reference the file does not have.
 *
 * The fifth is the one a customer saw. The document beside the form is built
 * from the DRAFT; the download is built from the SAVED ROW, because /api/render
 * takes a quoteId and loads it. So a tax mode switched after the save moved the
 * preview and not the file, and the button that handed over last week's document
 * said nothing about it. The seam now has two halves — a comparison of the two,
 * over a field list taken from the record's own type so a new field cannot be
 * left out of it, and a download that writes before it renders.
 *
 * These read the source rather than a rendered screen because the suite runs
 * in node with no DOM, and what is being guarded — a field going missing at
 * the seam — is plain in the source. The reference is the exception: the
 * decision is a pure function, so it is called rather than read, and only the
 * two sides taking their answer from the one call are checked in the source.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (...parts: string[]) => readFileSync(path.resolve(ROOT, ...parts), 'utf8')

/** The body of the object literal that opens at `label`, matching braces. */
function objectAfter(source: string, label: string) {
  const start = source.indexOf(label)
  expect(start, `${label} not found`).toBeGreaterThan(-1)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && (depth -= 1) === 0) return source.slice(open + 1, i)
  }
  throw new Error(`${label} never closes`)
}

/** Property names only — `draft.customer.name` carries no colon and is skipped. */
const keysOf = (block: string) => [...block.matchAll(/(\w+)\??:/g)].map((m) => m[1]!).sort()

/** Prose has colons in it too, and a colon is all `keysOf` has to go on. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the screens pass on what was built for them', () => {
  it('the editor gives the preview every customer field the document prints', () => {
    const printed = keysOf(objectAfter(read('web', 'src', 'components', 'DocumentPreview.tsx'), 'customer: {'))
    const supplied = keysOf(
      objectAfter(
        objectAfter(read('web', 'src', 'pages', 'QuoteEditor.tsx'), 'const preview: DocumentData = {'),
        'customer: {',
      ),
    )

    expect(printed.length, 'no customer fields found — the regex has lost its footing').toBeGreaterThan(2)
    expect(supplied, `the preview drops: ${printed.filter((k) => !supplied.includes(k)).join(', ')}`).toEqual(printed)
  })

  it('the editor gives a row to every term the schema declares', () => {
    const declared = keysOf(
      objectAfter(withoutComments(read('shared', 'schema.ts')), 'TermsSchema = z.object('),
    )
    const drafted = keysOf(
      objectAfter(withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx')), 'terms: {'),
    )

    expect(declared.length, 'no terms found — the regex has lost its footing').toBeGreaterThan(3)
    expect(drafted, `the draft drops: ${declared.filter((k) => !drafted.includes(k)).join(', ')}`).toEqual(declared)
  })

  it('the source screen shows every warning the draft raised', () => {
    const app = read('web', 'src', 'App.tsx')
    const destructured = /const \{([^}]*)\}\s*=\s*itemsFromLines\(/.exec(app)
    expect(destructured, 'itemsFromLines is no longer destructured here').not.toBeNull()

    const named = /\bwarnings\b\s*(?::\s*(\w+))?/.exec(destructured![1]!)
    expect(named, 'the warnings itemsFromLines returns are not taken off it').not.toBeNull()

    const alias = named![1] ?? 'warnings'
    expect(app, `${alias} is taken and never shown`).toContain(`...${alias}`)
  })

  it('the source screen shows every warning the warranty hoist raised', () => {
    const app = read('web', 'src', 'App.tsx')
    const destructured = /const \{([^}]*)\}\s*=\s*hoistWarranty\(/.exec(app)
    expect(destructured, 'hoistWarranty is no longer destructured here').not.toBeNull()

    const named = /\bwarnings\b\s*(?::\s*(\w+))?/.exec(destructured![1]!)
    expect(named, 'the warnings hoistWarranty returns are not taken off it').not.toBeNull()

    const alias = named![1] ?? 'warnings'
    expect(app, `${alias} is taken and never shown`).toContain(`...${alias}`)
  })

  it('the draft is built from the descriptions the hoist stripped', () => {
    // The one a customer would see: keep the items that went in rather than the
    // ones that came back, and the warranty prints inside the description AND
    // as term 5 — the same promise made twice on the one page.
    const app = read('web', 'src', 'App.tsx')
    const destructured = /const \{([^}]*)\}\s*=\s*hoistWarranty\(/.exec(app)
    expect(destructured, 'hoistWarranty is no longer destructured here').not.toBeNull()

    const named = /\bitems\b\s*(?::\s*(\w+))?/.exec(destructured![1]!)
    expect(named, 'the items hoistWarranty returns are not taken off it').not.toBeNull()

    const alias = named![1] ?? 'items'
    // The call, not the declaration above it — `newDraft(` matches both, and the
    // declaration names its parameter `items` whatever the screen passes in.
    const built = /setDraft\(\s*newDraft\(\s*(\w+)/.exec(app)
    expect(built?.[1], `newDraft is built from something other than ${alias}`).toBe(alias)
  })
})

describe('the reference number the desk chose', () => {
  it('is claimed only when it was changed', () => {
    // Untouched — the box is showing the server's own peek back at it — so
    // nothing is sent and the number stays the server's to hand out atomically
    // on save. An override every time and two saves that met would take the
    // same number.
    expect(chooseRef('RG', 46, 46).seqOverride).toBeUndefined()

    // Changed, so it is asked for by name.
    expect(chooseRef('RG', 45, 46).seqOverride).toBe(45)

    // The peek never arrived and the desk typed a number anyway. It must be
    // sent: allocate instead and the server picks something the document on
    // screen does not say.
    expect(chooseRef('RG', 45, null).seqOverride).toBe(45)
  })

  it('is shown exactly as it will be claimed', () => {
    const chosen = chooseRef('rg', 45, 46)
    expect(chosen.pendingRef).toBe('NCS/…/RG/045')
    expect(chosen.seqOverride).toBe(45)
  })

  it('is nothing at all until there is a number', () => {
    // Not 001, which is a number nobody chose and a reference another
    // quotation is already carrying.
    expect(chooseRef('RG', null, null)).toEqual({ pendingRef: 'NCS/…/RG/???' })
  })

  it('reaches the document and the request from the one decision', () => {
    const editor = withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx'))

    const shown = /pendingRef=\{(\w+)\.pendingRef\}/.exec(editor)
    expect(shown, 'the preview builds a pending reference of its own again').not.toBeNull()

    const decided = /const (\w+) = [^\n]*\b(\w+)\.seqOverride\b/.exec(editor)
    expect(decided, 'the number sent to the server is worked out somewhere else').not.toBeNull()

    expect(decided![2], 'the reference shown and the number sent come from different places').toBe(
      shown![1],
    )
    expect(editor, `${shown![1]} is no longer what chooseRef answered`).toMatch(
      new RegExp(`const ${shown![1]} = chooseRef\\(`),
    )

    // And the request carries that number rather than one it reached for itself.
    const payload = objectAfter(editor, "apiPost<Quote>('/api/quote', {")
    const carried = /[{,]\s*seqOverride\s*(?::\s*([\w.]+))?\s*[,}]/.exec(payload)
    expect(carried, 'the request no longer carries the chosen number').not.toBeNull()
    expect(carried![1] ?? 'seqOverride', 'the request sends a number of its own').toBe(decided![1])
  })
})

/**
 * A saved quotation and the screen it was saved from.
 *
 * Deliberately a repeat of the row that produced the bug: a Maharashtra
 * customer whose stored tax mode is CGST+SGST, which the desk then changed on
 * screen to one IGST row and downloaded.
 */
const SAVED: Quote = {
  id: 'q-028',
  ref: 'NCS/2026-27/Quotes/RG/028',
  revision: 0,
  date: '2026-08-18',
  customer: {
    name: 'Morgan Stanley',
    address: 'Nirlon Knowledge Park\nGoregaon East, Mumbai',
    attention: 'Mr Rao',
    gstin: '27AABCM1234F1Z5',
    state: 'Maharashtra',
  },
  contact: '+91 22 1234 5678',
  email: 'sales@newtech.example',
  signatory: 'R Gupta',
  items: [
    { desc: 'USB-C to USB-A 1.5 mtr', make: 'Black i', partCode: 'BI-TCHUGP', hsn: '8544', qty: 2, rate: 55_000 },
    { desc: 'Wireless keyboard', make: 'Logitech', partCode: 'MK540', hsn: '8471', qty: 1, rate: 425_000 },
  ],
  tax: { mode: 'CGST+SGST', rate: 18 },
  terms: {
    payment: '100% advance',
    delivery: '2 weeks',
    prices: 'Ex-works Mumbai',
    validity: '31st August 2026',
    warranty: '',
  },
  totals: { sub: 535_000, tax: 96_300, total: 631_300 },
  sourceThread: 'the thread this came out of',
  status: 'draft',
  createdAt: '2026-08-18T09:00:00.000Z',
}

/**
 * The screen as it stood the instant that record was written.
 *
 * `key` and `rateText` are the editor's own — a react key and a half-typed rate
 * box — and neither reaches a document, so this deliberately fills rateText with
 * something the formatter would never produce. A comparison that noticed it
 * would have the warning up on a quotation nobody has touched.
 */
const screenFor = (quote: Quote): QuoteDraft => ({
  date: quote.date,
  initials: 'RG',
  customer: {
    name: quote.customer.name,
    address: quote.customer.address,
    attention: quote.customer.attention,
    gstin: quote.customer.gstin ?? '',
    state: quote.customer.state ?? '',
  },
  contact: quote.contact,
  email: quote.email,
  signatory: quote.signatory,
  items: quote.items.map((item, i) => ({
    key: `row-${i}`,
    desc: item.desc,
    make: item.make,
    partCode: item.partCode,
    hsn: item.hsn ?? '',
    qty: item.qty,
    rate: item.rate,
    rateText: String(item.rate),
  })),
  tax: quote.tax,
  terms: quote.terms,
})

/**
 * One change per field, so the loop below is driven by the record's own field
 * list rather than by a list written out here. A field added to QuoteSchema and
 * classed as reaching the document fails to compile until it has a move.
 */
const MOVED: Record<DocumentField, (draft: QuoteDraft) => QuoteDraft> = {
  date: (d) => ({ ...d, date: '2026-09-01' }),
  customer: (d) => ({ ...d, customer: { ...d.customer, address: 'somewhere else entirely' } }),
  contact: (d) => ({ ...d, contact: '+91 22 0000 0000' }),
  email: (d) => ({ ...d, email: 'somebody.else@newtech.example' }),
  signatory: (d) => ({ ...d, signatory: 'S Nair' }),
  // Reordered, not retyped: a quotation whose lines are in a different order is
  // a different document, and a length-only check would call this unchanged.
  items: (d) => ({ ...d, items: [...d.items].reverse() }),
  tax: (d) => ({ ...d, tax: { ...d.tax, mode: 'IGST' } }),
  terms: (d) => ({ ...d, terms: { ...d.terms, validity: '30th September 2026' } }),
}

describe('the screen and the record it was saved as', () => {
  it('says nothing while they still agree', () => {
    expect(documentChanges(screenFor(SAVED), SAVED)).toEqual([])
  })

  it('says nothing about a quotation that has never been saved', () => {
    // No record behind it to disagree with, and the Save button already says so.
    expect(documentChanges(screenFor(SAVED), null)).toEqual([])
  })

  it('has an answer for every field a stored quotation has', () => {
    // The one that was actually missed: the schema grows a field, the screen
    // grows a box for it, and the comparison never hears about it — so the
    // download quietly goes back to being the older document for that field
    // alone. Every key of the record is either compared or declared to be none
    // of this screen's business; there is no third option.
    const stored = Object.keys(QuoteSchema.shape).sort()
    expect(
      [...DOCUMENT_FIELDS, ...NOT_COMPARED].sort(),
      `unclassified: ${stored.filter((k) => ![...DOCUMENT_FIELDS, ...NOT_COMPARED].includes(k as never)).join(', ')}`,
    ).toEqual(stored)
  })

  it('notices every field that reaches the document', () => {
    for (const field of DOCUMENT_FIELDS) {
      expect(
        documentChanges(MOVED[field](screenFor(SAVED)), SAVED),
        `a changed ${field} goes unnoticed, so the download stays the older document`,
      ).toContain(field)
    }
  })

  it('notices the tax rate typed over, not only the mode', () => {
    const screen = screenFor(SAVED)
    const changed = { ...screen, tax: { ...screen.tax, rate: 12 } }
    expect(documentChanges(changed, SAVED)).toContain('tax')
  })

  it('notices every customer field the record carries', () => {
    for (const field of Object.keys(CustomerSchema.shape)) {
      const screen = screenFor(SAVED)
      const customer = { ...screen.customer, [field]: 'something else' } as QuoteDraft['customer']
      expect(
        documentChanges({ ...screen, customer }, SAVED),
        `a changed customer ${field} goes unnoticed`,
      ).toContain('customer')
    }
  })

  it('notices every field a line carries', () => {
    for (const field of Object.keys(QuoteItemSchema.shape)) {
      const screen = screenFor(SAVED)
      const first = screen.items[0]! as unknown as Record<string, unknown>
      // Rates and quantities are integers — paise for the rate — so they are
      // moved by one rather than replaced with a word.
      const moved = typeof first[field] === 'number' ? (first[field] as number) + 1 : 'something else'
      const items = [{ ...screen.items[0]!, [field]: moved } as EditorItem, ...screen.items.slice(1)]
      expect(
        documentChanges({ ...screen, items }, SAVED),
        `a changed ${field} on a line goes unnoticed`,
      ).toContain('items')
    }
  })

  it('notices every term the schema declares', () => {
    for (const field of Object.keys(TermsSchema.shape)) {
      const screen = screenFor(SAVED)
      const terms = { ...screen.terms, [field]: 'something else' } as QuoteDraft['terms']
      expect(
        documentChanges({ ...screen, terms }, SAVED),
        `a changed ${field} term goes unnoticed`,
      ).toContain('terms')
    }
  })

  it('reads a blank box and an empty column as the same absent value', () => {
    // The record holds undefined where the form holds ''. Read as a difference,
    // the warning would be up on every quotation with no GSTIN on file.
    const bare: Quote = { ...SAVED, customer: { ...SAVED.customer, gstin: undefined, state: undefined } }
    expect(documentChanges(screenFor(bare), bare)).toEqual([])
  })

  it('names what changed in words the desk can read', () => {
    const screen = MOVED.tax(MOVED.customer(screenFor(SAVED)))
    expect(changeLabels(documentChanges(screen, SAVED))).toEqual(['the customer', 'the tax'])
  })
})

describe('downloading a quotation the screen has moved on from', () => {
  it('writes the changes before anything is rendered', async () => {
    const order: string[] = []
    await downloadCurrent({
      changed: true,
      persist: async () => void order.push('persist'),
      render: async () => void order.push('render'),
    })
    expect(order, 'the file was built from the record before the record caught up').toEqual([
      'persist',
      'render',
    ])
  })

  it('renders nothing at all when the write failed', async () => {
    // Otherwise this is the original bug with an error message over it: the desk
    // still gets the older document, and now believes it is current.
    let rendered = false
    await expect(
      downloadCurrent({
        changed: true,
        persist: () => Promise.reject(new Error('is marked sent and can no longer be edited')),
        render: async () => void (rendered = true),
      }),
    ).rejects.toThrow(/marked sent/)
    expect(rendered, 'the older document was handed over anyway').toBe(false)
  })

  it('writes nothing when the screen and the record already agree', async () => {
    let persisted = false
    await downloadCurrent({
      changed: false,
      persist: async () => void (persisted = true),
      render: async () => {},
    })
    expect(persisted, 'an untouched quotation was rewritten just to download it').toBe(false)
  })

  it('is the only route the buttons have to the renderer', () => {
    const editor = withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx'))
    const body = objectAfter(editor, 'async function download(')

    expect(body, 'the download no longer goes through downloadCurrent').toContain('downloadCurrent(')
    // Inside the call rather than beside it: handed over as the step that runs
    // second, not fired off in parallel with the write.
    const ordered = objectAfter(body, 'downloadCurrent(')
    expect(ordered, 'the render is not the one downloadCurrent orders').toContain('apiDownload(')
    expect(
      [...editor.matchAll(/apiDownload\(/g)].length,
      'something renders without ordering the write first',
    ).toBe(1)

    // And the flag it is ordered by is the one the buttons label themselves
    // from: a press that writes has to be a press that said it would, and the
    // fixed guard has to be in the same answer or the screen asks for a PUT it
    // knows will come back 409.
    const flag = /changed:\s*(\w+)/.exec(ordered)
    expect(flag, 'the download no longer decides whether it is writing').not.toBeNull()
    const name = flag![1]!
    expect(editor, name + ' is not the difference and the draft guard together').toMatch(
      new RegExp(String.raw`const ${name} = changes\.[^\n]*\bfixed\b`),
    )
    expect(
      [...editor.matchAll(new RegExp(String.raw`\b${name}\b`, 'g'))].length,
      name + ' decides the write but never reaches the buttons',
    ).toBeGreaterThan(3)
  })

  it('writes through the update route and keeps what it answers', () => {
    const editor = withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx'))
    const persist = objectAfter(editor, 'async function persist(')

    expect(persist, 'the edit no longer goes to the update route').toMatch(/\/api\/quotes\//)
    // The row read back after the commit, not the request echoed — this screen
    // exists because a screen and a record disagreed, so it takes the record's
    // word for what it now holds.
    expect(persist, "the update's answer is not what the screen goes on showing").toContain('onSaved(')
  })

  it('sends nothing that would decide a reference', () => {
    // All three are a 400 on PUT, and refused rather than stripped for a reason:
    // an edit that quietly kept the old reference under new initials would be
    // this very divergence again.
    const body = objectAfter(withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx')), 'function documentBody(')
    for (const decides of ['initials', 'seqOverride', 'reviseOf']) {
      expect(body, `the body an edit sends carries ${decides}`).not.toContain(decides)
    }
  })

  it('warns and writes from the one answer', () => {
    // The callout says a thing and the button does a thing; worked out twice
    // they drift, and the drift is silent — a button that writes beside a screen
    // that never said it would.
    const editor = withoutComments(read('web', 'src', 'pages', 'QuoteEditor.tsx'))
    expect(editor, 'the difference is worked out somewhere other than documentChanges').toMatch(
      /const changes = documentChanges\(draft, saved\)/,
    )
    expect(
      [...editor.matchAll(/documentChanges\(/g)].length,
      'the screen asks twice, and can be told two different things',
    ).toBe(2)
  })
})

/**
 * The seam between the browser and the server that is not code at all — it is
 * two config files naming the same port, and for days they named different ones.
 *
 * vite.config.ts proxied /api to a hardcoded :4000 while .env said PORT=5050, so
 * every request the browser made went to a port with nothing on it. The AI
 * button did nothing, and it had been masked all along by a server left over
 * from an earlier run that happened to still be sitting on 4000. Killing that
 * stale process is what finally revealed it.
 */
describe('the port the browser is sent to', () => {
  const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const viteConfig = readFileSync(path.join(REPO, 'vite.config.ts'), 'utf8')

  it('is read from the environment, never written down twice', () => {
    const proxy = /['"]\/api['"]\s*:\s*(.+)/.exec(viteConfig)?.[1] ?? ''
    expect(proxy, 'the /api proxy target was not found — has the config moved?').not.toBe('')

    // A literal port here is the bug: it agrees with .env only by luck, and
    // stops agreeing the moment somebody changes one of them.
    expect(proxy, 'the proxy target hardcodes a port').not.toMatch(/localhost:\d+/)
    expect(proxy).toContain('API_PORT')
    expect(viteConfig, 'API_PORT is not taken from the environment').toMatch(
      /API_PORT\s*=\s*Number\(process\.env\.PORT/,
    )
  })

  it('falls back to the same default the server does', () => {
    // Both sides must agree about what "unset" means, or an .env without PORT
    // reintroduces exactly this split.
    const serverConfig = readFileSync(path.join(REPO, 'server', 'src', 'config.ts'), 'utf8')
    const serverDefault = /process\.env\.PORT\s*\?\?\s*(\d+)/.exec(serverConfig)?.[1]
    const viteDefault = /process\.env\.PORT\s*\?\?\s*(\d+)/.exec(viteConfig)?.[1]

    expect(serverDefault, 'the server default port was not found').toBeDefined()
    expect(viteDefault, 'the proxy default port was not found').toBeDefined()
    expect(viteDefault).toBe(serverDefault)
  })
})
