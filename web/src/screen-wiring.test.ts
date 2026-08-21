import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chooseRef } from './pages/QuoteEditor'

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
