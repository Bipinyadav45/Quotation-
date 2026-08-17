import { describe, expect, it } from 'vitest'
import { SAMPLE_THREAD } from '@shared/sample.js'
import { extractPartCode, firstLength, parseThread, splitBlocks } from './parser.js'

const lines = parseThread(SAMPLE_THREAD)
const requests = lines.filter((l) => l.role === 'request')
const offers = lines.filter((l) => l.role === 'offer')

describe('splitBlocks — §5', () => {
  it('splits the §11 thread on its two "wrote:" headers and captures each sender', () => {
    const blocks = splitBlocks(SAMPLE_THREAD).filter((b) => b.sender !== '')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.sender).toBe('rakhi.gupte@newtech.in')
    expect(blocks[1]!.sender).toBe('subhransu.kar@morganstanley.com')
  })

  it('also splits on From: headers', () => {
    const blocks = splitBlocks(
      'From: someone <a@b.com>\nSent: Monday\nline one\nFrom: other <c@d.com>\nline two',
    ).filter((b) => b.sender !== '')
    expect(blocks.map((b) => b.sender)).toEqual(['a@b.com', 'c@d.com'])
  })
})

describe('parseThread — §11 expected parse', () => {
  it('finds 5 requests and 5 offers', () => {
    expect(requests).toHaveLength(5)
    expect(offers).toHaveLength(5)
  })

  it('strips qty and price from the description, leaving the product', () => {
    expect(offers.map((o) => o.desc)).toEqual([
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB-C to USB-C 1.5 mtr',
      'Lightning to USB A 1.5 mtr',
      'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
    ])
    expect(requests.map((r) => r.desc)).toEqual([
      'Black i USB-C to USB-A 1.5 mtr',
      'Black i USB-C to USB-C 1 mtr',
      'Black i Lightning to USB A 1.5 mtr',
      'Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP',
      'Logitech Wireless Keyboard and Mouse Set #MK540',
    ])
  })

  it('reads every quantity, through both "Qty- 02" and "Qty - 01" spacings', () => {
    expect(offers.map((o) => o.qty)).toEqual([2, 2, 2, 1, 1])
    expect(requests.map((r) => r.qty)).toEqual([2, 2, 2, 1, 1])
  })

  it('reads every rate as paise, including "1,250" and the space-less "2750+"', () => {
    expect(offers.map((o) => o.rate)).toEqual([55_000, 85_000, 125_000, 275_000, 345_000])
  })

  it('leaves requests with no rate', () => {
    expect(requests.every((r) => r.rate === 0)).toBe(true)
  })

  it('§5 role assignment — priced lines are offers, quantity-only lines are requests', () => {
    expect(offers.every((o) => o.rate > 0)).toBe(true)
    expect(requests.every((r) => r.rate === 0)).toBe(true)
  })

  it('nothing in the fixture needs manual role reassignment', () => {
    // Every priced line came from newtech.in and every bare-quantity line came
    // from the customer, so the heuristic and the sender agree throughout.
    expect(lines.some((l) => l.roleUncertain)).toBe(false)
  })

  it('flags a priced line that arrived from the customer', () => {
    const parsed = parseThread(
      'On Fri, Jul 10, 2026 at 1:24 PM <buyer@morganstanley.com> wrote:\n' +
        'Target price for the dock, Qty- 01 - Rs. 2,500',
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.role).toBe('offer')
    expect(parsed[0]!.roleUncertain).toBe(true)
  })

  it('keeps the raw line verbatim for audit', () => {
    expect(offers[0]!.raw).toBe('Black i USB-C to USB-A 1.5 mtr, Qty- 02 -  Rs. 550 + gst each')
  })

  it('assigns stable ids', () => {
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length)
    expect(parseThread(SAMPLE_THREAD).map((l) => l.id)).toEqual(lines.map((l) => l.id))
  })
})

describe('brand extraction — CORRECTION 4', () => {
  it('finds the two-word, lowercase-second-token make that no capitalisation rule would', () => {
    expect(offers[0]!.make).toBe('Black i')
    expect(requests[2]!.make).toBe('Black i')
    expect(offers[4]!.make).toBe('Logitech')
  })

  it('leaves the make empty on the offer line that dropped it — the §11 flag', () => {
    expect(offers[2]!.make).toBe('')
  })
})

describe('extractPartCode — §5', () => {
  it('finds the codes in the fixture', () => {
    expect(offers[3]!.partCode).toBe('BI-TCHUGP')
    expect(offers[4]!.partCode).toBe('MK540')
  })

  it('leaves cable lines without a code', () => {
    expect(offers[0]!.partCode).toBe('')
    expect(offers[1]!.partCode).toBe('')
    expect(offers[2]!.partCode).toBe('')
  })

  it('§5 — excludes USB, TYPE, GST and INR', () => {
    expect(extractPartCode('USB TYPE GST INR')).toBe('')
    expect(extractPartCode('USB-C to USB-A cable')).toBe('')
  })

  it('does not invent codes from an ALL-CAPS line', () => {
    // Without the digit-or-hyphen guard this yields a phantom code, which
    // raises a false `code` block flag and costs the amber strip its meaning.
    expect(extractPartCode('DOCKING STATION WITH FOUR PORTS')).toBe('')
  })
})

describe('firstLength — §6 spec rule input', () => {
  it('reads the first length and ignores later ones', () => {
    expect(firstLength('Black i USB-C to USB-A 1.5 mtr')).toBe(1.5)
    expect(firstLength('Black i USB-C to USB-C 1 mtr')).toBe(1)
    expect(firstLength('cable 2 mtr, spare 3 mtr')).toBe(2)
    expect(firstLength('Logitech Wireless Keyboard')).toBeNull()
  })
})

describe('skip rules and de-duplication — §5', () => {
  it('skips salutations, signatures and disclaimers', () => {
    const parsed = parseThread(
      [
        'On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
        'Dear Sir,',
        'Thanks,',
        'Regards',
        'Tel: 022 40668888',
        'Sent from my iPhone',
        'Get Outlook for iOS',
        'DISCLAIMER: This email and any attachments, Qty- 99',
        'Real Product 1.5 mtr, Qty- 02 - Rs. 550',
      ].join('\n'),
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.desc).toBe('Real Product 1.5 mtr')
  })

  it('de-duplicates re-quoted lines even when the quoting changed the indentation', () => {
    const parsed = parseThread(
      [
        'On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
        'Cable 1.5 mtr, Qty- 02 - Rs. 550',
        '>  Cable 1.5 mtr,   Qty- 02 - Rs. 550',
        '> > Cable 1.5 mtr, Qty- 02 - Rs. 550',
      ].join('\n'),
    )
    expect(parsed).toHaveLength(1)
  })

  it('keeps a request and an offer that share the same text', () => {
    const parsed = parseThread(
      [
        'On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
        'Cable 1.5 mtr, Qty- 02 - Rs. 550',
        'On Fri, Jul 10, 2026 at 1:24 PM <buyer@morganstanley.com> wrote:',
        'Cable 1.5 mtr, Qty- 02',
      ].join('\n'),
    )
    expect(parsed).toHaveLength(2)
    expect(parsed.map((p) => p.role).sort()).toEqual(['offer', 'request'])
  })
})
