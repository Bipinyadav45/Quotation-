import { describe, expect, it, vi } from 'vitest'
import { splitDescription } from '@shared/description.js'

/**
 * The model is mocked rather than called. A test that spends a live API call to
 * discover what a model felt like answering today reports the weather, not the
 * code — and the thing under test here is what happens when the model ignores
 * the instruction anyway.
 */
const askAi = vi.hoisted(() => vi.fn())
vi.mock('./ai.js', () => ({ askAi, aiAvailable: () => true }))
const { parseThreadWithClaude, splitSingleLineDescription } = await import('./llmParser.js')

/**
 * The two lines the DGSL thread in parser.test.ts carries — the product and the
 * specification under it — run together as the model sometimes returns them.
 * The pattern parser yields 'HP 280 G9 MT ( MII )' as the name, and so must
 * this, or the same thread quotes two different product names depending on
 * which parser the desk pressed.
 */
const DGSL_ON_ONE_LINE =
  'HP 280 G9 MT ( MII ) Core i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, Win 11 Pro., 3 Years Warranty.'

describe('splitSingleLineDescription — the split the document prints', () => {
  it('leaves a description the model already split alone', () => {
    const both = 'HP 280 G9 MT Desktop\nCore i5-14400, 16 GB RAM, 512GB SSD, 3 Years Warranty'
    expect(splitSingleLineDescription(both)).toBe(both)
  })

  it('splits a one-line description where the specification starts', () => {
    expect(splitSingleLineDescription(DGSL_ON_ONE_LINE)).toBe(
      'HP 280 G9 MT ( MII )\nCore i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, Win 11 Pro., 3 Years Warranty.',
    )
  })

  it('gives the document the product name the pattern parser gives it', () => {
    const { descName, descSpec } = splitDescription(splitSingleLineDescription(DGSL_ON_ONE_LINE))
    expect(descName).toBe('HP 280 G9 MT ( MII )')
    expect(descSpec).toMatch(/^Core i5-14500/)
  })

  it('splits before the number when the unit is a word of its own', () => {
    // "16 GB" is a specification only as a pair; splitting between the number
    // and its unit would print "...Desktop 16 GB" as the product name.
    expect(splitSingleLineDescription('HP 280 G9 MT Desktop 16 GB RAM 512GB SSD')).toBe(
      'HP 280 G9 MT Desktop\n16 GB RAM 512GB SSD',
    )
  })

  it('collapses the runs of whitespace a pasted line carries', () => {
    expect(splitSingleLineDescription('HP 280 G9 MT Desktop  Core i5-14400,  16 GB RAM')).toBe(
      'HP 280 G9 MT Desktop\nCore i5-14400, 16 GB RAM',
    )
  })

  it('leaves a name-only description alone', () => {
    // A name-only line is correct and common: the Morgan Stanley thread is
    // nothing else. "14 inch" and "1.5 mtr" are parts of those names, and a
    // lone hardware word is not enough to call the rest a specification.
    for (const name of [
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
      'HP ProBook 440 14 inch G11 Notebook PC',
      'HP 22" TFT',
    ]) {
      expect(splitSingleLineDescription(name), name).toBe(name)
    }
  })

  it('never lifts a name off a line that is all specification', () => {
    const spec = 'Core i5-14400, 16 GB RAM, 512GB SSD'
    expect(splitSingleLineDescription(spec)).toBe(spec)
  })

  it('is safe on an empty description', () => {
    expect(splitSingleLineDescription('')).toBe('')
    expect(splitSingleLineDescription('   ')).toBe('   ')
  })
})

const THREAD = [
  'On Wed, Jun 17, 2026 at 4:09 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
  'HP 280 G9 MT ( MII ) - Rs. 83,000 + gst each',
].join('\n')

const LINE = {
  raw: 'HP 280 G9 MT ( MII ) - Rs. 83,000 + gst each',
  desc: DGSL_ON_ONE_LINE,
  make: 'HP',
  partCode: '',
  qty: 25,
  rateText: '83,000',
  role: 'offer',
}

describe('parseThreadWithClaude', () => {
  it('repairs a description the model returned on one line', async () => {
    askAi.mockResolvedValue({ ok: true, data: { lines: [LINE] } })

    const { lines, source } = await parseThreadWithClaude(THREAD)
    expect(source).toBe('llm')
    expect(splitDescription(lines[0]!.desc).descName).toBe('HP 280 G9 MT ( MII )')
    expect(lines[0]!.rate).toBe(8_300_000)
  })

  it('still returns the pattern parser with a note when the model fails', async () => {
    askAi.mockResolvedValue({ ok: false, reason: 'The AI service did not answer.' })

    const result = await parseThreadWithClaude(THREAD)
    expect(result.source).toBe('pattern')
    expect(result.note).toContain('pattern parser')
    expect(result.lines.length).toBeGreaterThan(0)
  })

  it('still returns the pattern parser when the model finds no lines', async () => {
    askAi.mockResolvedValue({ ok: true, data: { lines: [] } })

    const result = await parseThreadWithClaude(THREAD)
    expect(result.source).toBe('pattern')
    expect(result.note).toContain('pattern parser')
  })
})
