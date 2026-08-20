import PizZip from 'pizzip'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { config } from '../config.js'
import { buildRenderModel } from './docx.js'
import type { Quote } from '@shared/schema.js'

/**
 * Every tag in the template must be a field the render model supplies.
 *
 * A renamed field is silent: docxtemplater's nullGetter turns the unknown tag
 * into "", so the document prints the label with nothing after it. That is
 * exactly what happened when `{warranty}` was renamed to `{validity}` in the
 * model but not in the template — a quotation went out with "4. Warranty :" and
 * no value, and nothing failed.
 */
const QUOTE: Quote = {
  id: 't', ref: 'NCS/2026-27/Quotes/RG/001', revision: 0, date: '2026-08-20',
  customer: { name: 'A', address: 'B', attention: 'C' },
  contact: '1', email: 'e', signatory: 's',
  items: [{ desc: 'd', make: 'm', partCode: 'p', qty: 1, rate: 100 }],
  tax: { mode: 'IGST', rate: 18 },
  terms: { payment: 'p', delivery: 'd', prices: 'pr', validity: 'v' },
  totals: { sub: 100, tax: 18, total: 118 },
  sourceThread: '', status: 'draft', createdAt: '',
}

describe('the template and the render model agree', () => {
  const xml = new PizZip(readFileSync(config.templatePath)).file('word/document.xml')!.asText()
  const model = buildRenderModel(QUOTE) as unknown as Record<string, unknown>

  /** Tags, minus the loop open/close markers which are structural. */
  const tags = [...new Set([...xml.matchAll(/\{([#/^]?)(\w+)\}/g)].map((m) => m[2]!))]

  it('finds the tags at all — a template with none would pass everything else', () => {
    expect(tags.length).toBeGreaterThan(10)
  })

  it('every tag is supplied by the model, at the top level or inside a loop', () => {
    const loopFields = new Set<string>()
    for (const value of Object.values(model)) {
      if (Array.isArray(value)) {
        for (const row of value) Object.keys(row as object).forEach((k) => loopFields.add(k))
      }
    }

    const missing = tags.filter((t) => !(t in model) && !loopFields.has(t))
    expect(missing, `template tags with no value: ${missing.join(', ')}`).toEqual([])
  })

  it('every model field is actually used by the template', () => {
    // The other direction: a field computed and never printed is dead weight,
    // and usually means a tag was renamed on one side only.
    const unused = Object.keys(model).filter((k) => !tags.includes(k))
    expect(unused, `model fields the template never prints: ${unused.join(', ')}`).toEqual([])
  })
})
