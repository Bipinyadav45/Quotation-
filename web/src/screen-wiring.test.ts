import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The two points where a screen hands on work something else did for it.
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
 * These read the source rather than a rendered screen because the suite runs
 * in node with no DOM, and what is being guarded — a field going missing at
 * the seam — is plain in the source.
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

  it('the source screen shows every warning the draft raised', () => {
    const app = read('web', 'src', 'App.tsx')
    const destructured = /const \{([^}]*)\}\s*=\s*itemsFromLines\(/.exec(app)
    expect(destructured, 'itemsFromLines is no longer destructured here').not.toBeNull()

    const named = /\bwarnings\b\s*(?::\s*(\w+))?/.exec(destructured![1]!)
    expect(named, 'the warnings itemsFromLines returns are not taken off it').not.toBeNull()

    const alias = named![1] ?? 'warnings'
    expect(app, `${alias} is taken and never shown`).toContain(`...${alias}`)
  })
})
