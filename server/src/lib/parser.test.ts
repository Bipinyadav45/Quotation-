import { describe, expect, it } from 'vitest'
import { SAMPLE_THREAD } from '@shared/sample.js'
import {
  extractPartCode,
  firstLength,
  parseThread,
  parseThreadDetailed,
  splitBlocks,
} from './parser.js'

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

/**
 * A real thread out of the desk's mailbox, reduced to the shape that broke the
 * parser. Two things here that §11's fixture does not have:
 *
 *   1. "Qty- 04nos." — the unit runs straight into the digits, and §5's
 *      pattern ends in \b, which cannot match between "4" and "n". The line
 *      did not match at all.
 *   2. the quantity sits on its OWN line, under the product, with the
 *      specification in between — §5 assumes one line per item.
 *
 * Between them, both products came out with no quantity, and the builder's
 * `|| 1` fallback turned that into a quotation for one of each.
 */
const HP_THREAD = [
  'On Mon, Jul 27, 2026 at 11:59 AM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
  'Dear Sir,',
  'Please find details below -',
  '',
  'HP 280 G9 MT Desktop - Rs. 87,250 + gst each ( Very limited stocks)',
  'Core i5-14400,  16 GB RAM, 512GB SSD, Wi-Fi, Onboard , Win 11 Pro., 3 Years Warranty',
  '',
  'Qty- 04nos.',
  '',
  'HP 22" TFT - Rs. 6,750 + gst each',
  '',
  'Qty- 08nos.',
  '',
  'Price valid for 2 days / till stocks last.',
  '',
  'Thanks & Regards,',
].join('\n')

describe('a quantity on its own line, and a unit stuck to the digits', () => {
  const parsed = parseThread(HP_THREAD)

  it('finds both products and nothing else', () => {
    expect(parsed).toHaveLength(2)
  })

  it('reads 04 and 08 — the bug that reached a customer quotation', () => {
    expect(parsed.map((p) => p.qty)).toEqual([4, 8])
  })

  it('still reads the rates', () => {
    expect(parsed.map((p) => p.rate)).toEqual([8_725_000, 675_000])
  })

  it('carries the specification into the description, where it is quoted from', () => {
    expect(parsed[0]!.desc).toBe(
      'HP 280 G9 MT Desktop\nCore i5-14400, 16 GB RAM, 512GB SSD, Wi-Fi, Onboard , Win 11 Pro., 3 Years Warranty',
    )
    expect(parsed[1]!.desc).toBe('HP 22" TFT')
  })

  it('does not swallow the sales patter as a specification', () => {
    for (const line of parsed) {
      expect(line.desc).not.toContain('Price valid')
      expect(line.desc).not.toContain('stocks last')
    }
  })

  it('does not overwrite a quantity the product line already stated', () => {
    const twice = parseThread(
      [
        'On Mon, Jul 27, 2026 at 11:59 AM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
        'Widget A - Rs. 100 each, Qty- 02',
        'Qty- 09nos.',
      ].join('\n'),
    )
    expect(twice).toHaveLength(1)
    expect(twice[0]!.qty).toBe(2)
  })

  it('reads the quantity spellings that appear in real threads', () => {
    const out = parseThread(
      [
        'On Mon, Jul 27, 2026 at 11:59 AM a <a@newtech.in> wrote:',
        'Widget - Rs. 100 each',
        'Qty- 04nos.',
        'Gadget - Rs. 200 each',
        'Quantity- 12',
        'Gizmo - Rs. 300 each',
        'Qty : 7 Nos',
      ].join('\n'),
    )
    expect(out.map((p) => p.qty)).toEqual([4, 12, 7])
  })

  it('does not carry a quantity across into the next block', () => {
    const out = parseThread(
      [
        'On Mon, Jul 27, 2026 at 11:59 AM a <a@newtech.in> wrote:',
        'Widget - Rs. 100 each',
        'On Mon, Jul 27, 2026 at 10:00 AM b <b@customer.com> wrote:',
        'Qty- 09nos.',
      ].join('\n'),
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.qty).toBe(0)
  })
})


/**
 * A second real thread, this one an incoming RFQ. It breaks three more of §5's
 * assumptions:
 *
 *   1. "4 nos desktop" — the quantity carries no "Qty" keyword at all, just a
 *      number and a counting unit.
 *   2. the product comes AFTER the quantity, where §5 takes the description
 *      from the text BEFORE it. Read §5's way, this line describes "Pls quote".
 *   3. "Quote tft separately" asks for a product with neither a quantity nor a
 *      price, so §5 does not consider it a candidate line at all — and a
 *      product the customer asked for silently vanishes.
 *
 * The signature block is included verbatim, image link and all, because none of
 * it may come through as a product.
 */
const RFQ_THREAD = [
  'On Thu, Jul 9, 2026 at 7:42 AM Alex Abraham <alex.abraham@datamatics.com> wrote:',
  '',
  '',
  'Pls quote 4 nos desktop with 16 gb ram 512 ssd win 11 prof',
  '',
  'Quote tft separately',
  '',
  '',
  '[https://www.datamatics.com/hubfs/e-mail-Signature%201.jpg]<https://www.youtube.com/watch?v=WmeaxfRikIY>',
  '',
  '--',
  '-- ',
  'Please call/email in case of any queries.',
  '',
  'Thanks & Regards,',
  '',
  'Newtech Computer Services Pvt. Ltd.',
  'Rakhi Gupte',
  'Tel  : +91 22 40668888',
  'DID : +91 22 40668809',
  'Cell : +91 9870450278',
].join('\n')

describe('an incoming RFQ with no Qty keyword and no prices', () => {
  const parsed = parseThread(RFQ_THREAD)

  it('finds exactly the two products asked for, and nothing from the signature', () => {
    expect(parsed).toHaveLength(2)
  })

  it('reads "4 nos" as a quantity even with no Qty keyword', () => {
    expect(parsed[0]!.qty).toBe(4)
  })

  it('takes the product from AFTER the quantity when the text before it is only an instruction', () => {
    expect(parsed[0]!.desc).toBe('desktop with 16 gb ram 512 ssd win 11 prof')
  })

  it('keeps a product that was asked for with no quantity and no price', () => {
    expect(parsed[1]!.desc).toBe('tft')
    expect(parsed[1]!.qty).toBe(0)
  })

  it('treats both as the customer asking, not as us quoting', () => {
    expect(parsed.every((l) => l.role === 'request')).toBe(true)
    expect(parsed.every((l) => l.rate === 0)).toBe(true)
  })

  it('never turns the signature, the phone numbers or the image link into a product', () => {
    const descriptions = parsed.map((l) => l.desc.toLowerCase()).join(' | ')
    for (const fragment of [
      'datamatics.com',
      'youtube',
      'signature',
      'newtech computer services',
      'rakhi',
      '40668888',
      '9870450278',
      'queries',
    ]) {
      expect(descriptions, `"${fragment}" leaked into a product description`).not.toContain(
        fragment,
      )
    }
  })
})

describe('counting units, and instructions that are not products', () => {
  const parse1 = (line: string) =>
    parseThread(['On Thu, Jul 9, 2026 at 7:42 AM a <a@x.com> wrote:', line].join('\n'))

  it('reads the counting units that appear in real mail', () => {
    expect(parse1('Pls quote 4 nos desktop')[0]?.qty).toBe(4)
    expect(parse1('Pls quote 2 pcs monitor')[0]?.qty).toBe(2)
    expect(parse1('Pls quote 10 units keyboard')[0]?.qty).toBe(10)
    expect(parse1('Pls quote 1 no. docking station')[0]?.qty).toBe(1)
  })

  it('does not mistake a specification for a quantity', () => {
    // "16 gb", "512 ssd" and "win 11" must not be read as counts.
    expect(parse1('Pls quote 4 nos desktop with 16 gb ram 512 ssd win 11 prof')[0]?.qty).toBe(4)
  })

  it('does not invent a product out of ordinary prose', () => {
    expect(parse1('Please find details below -')).toHaveLength(0)
    expect(parse1('Price valid for 2 days / till stocks last.')).toHaveLength(0)
    expect(parse1('Awaiting your revert on the below.')).toHaveLength(0)
    expect(parse1('Newtech Computer Services Pvt. Ltd.')).toHaveLength(0)
  })

  it('still reads §5 lines where the description comes first', () => {
    const line = parse1('Black i USB-C to USB-A 1.5 mtr, Qty- 02 - Rs. 550 + gst each')[0]
    expect(line?.desc).toBe('Black i USB-C to USB-A 1.5 mtr')
    expect(line?.qty).toBe(2)
  })
})

describe('what the parser could not read is reported, never dropped', () => {
  it('names the lines that produced no product', () => {
    const { lines, skipped } = parseThreadDetailed(
      [
        'On Thu, Jul 9, 2026 at 7:42 AM a <a@x.com> wrote:',
        'Widget - Rs. 100 each, Qty- 02',
        'Also we may need the mounting bracket for it',
        'Awaiting your revert.',
      ].join('\n'),
    )
    expect(lines).toHaveLength(1)
    expect(skipped).toEqual([
      'Also we may need the mounting bracket for it',
      'Awaiting your revert.',
    ])
  })

  it('does not report signature noise, or the report is useless', () => {
    const { skipped } = parseThreadDetailed(RFQ_THREAD)
    const joined = skipped.join(' | ')
    for (const noise of [
      'https://',
      '--',
      '+91 22 40668888',
      '9870450278',
      // Everything below the sign-off is signature. A warning that is entirely
      // false is one the desk learns to scroll past.
      'Newtech Computer Services',
      'Rakhi Gupte',
    ]) {
      expect(joined, `"${noise}" should not be reported`).not.toContain(noise)
    }
    expect(skipped).toEqual([])
  })

  it('reports nothing when every line was understood', () => {
    const { skipped } = parseThreadDetailed(SAMPLE_THREAD)
    expect(skipped).toEqual([])
  })
})

/**
 * A forwarded chain out of the desk's mailbox. It carries an attachment, mail
 * client furniture, totals rows, wrapped product descriptions, and — the part a
 * pattern parser cannot solve — four revisions of the same quotation at four
 * different prices.
 */
const DGSL_THREAD = [
  'Fwd: Re: quote - Revised',
  'Contact photo',
  'From purchase1@newtech.co.in on 2026-08-18 17:39',
  'Details Plain text',
  'Quotation-DGSL(Pondicherry) 23rd June 2026 -- HP ProBook - 06 Nos. & HP 280 G9 - 25 Nos.docx',
  '(~57 KB)',
  '18th August 2026.',
  '',
  'Dear Rohit',
  '',
  '-------- Original Message --------',
  'Subject:	Re: quote - Revised',
  'Date:	23/06/2026 12:22 PM',
  '',
  'On Wed, Jun 17, 2026 at 4:09 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:',
  '',
  'Dear Sir,',
  '',
  'Please find details below -',
  '',
  'HP ProBook 4 G1iR 14 Notebook Probook/440 G11- Rs. 1,04,500 + gst each',
  'U5-125U/16GB/1TB SSD/FHD 300 Nits/BLK/FPR/MII/Win 11 Pro/1 Yr Onsite/ Bag',
  '3 Years NBD and 3 Years ADP - Rs. 7,000 + gst each additional',
  'Total - Rs. 1,11,500 + gst each ( with 3 Year Onsite + ADP)',
  '',
  'HP 280 G9 MT ( MII ) - Rs. 83,000 + gst each',
  'Core i5-14500,  8GB DDR5, 512GB SSD,  Wi-Fi, Onboard, , Win 11 Pro., 3 Years Warranty.',
  'Additional 8GB HP Memory - Rs. 12,500 + gst each',
  'Total - Rs. 95,500 + gst each with 16GB Memory',
  '',
  'On Mon, Jun 15, 2026 at 1:41 PM Alex Abraham <alex.abraham@datamatics.com> wrote:',
  '',
  'Share quote for the below',
  '',
  'HP Pro Tower 280 G9 PCI Desktop PC',
  'i5-13500/16GB DDR4/512GB SSD/Wi-Fi/MII/Win11Pro/3',
  'Yrs Onsite Without Monitor ---- 25 nos....',
  '',
  'HP ProBook 440 14 inch G11 Notebook PC',
  'ProBook/440 G11/U5-125U/16GB/1TB SSD/FHD 300',
  'Nits/BLK/FPR/MII/Win 11 Pro/3 Yr Onsite with ADP  -- 6 nos',
].join('\n')

describe('a forwarded chain with an attachment, totals rows and wrapped descriptions', () => {
  const { lines, skipped } = parseThreadDetailed(DGSL_THREAD)
  const offers = lines.filter((l) => l.role === 'offer')
  const requests = lines.filter((l) => l.role === 'request')

  it('never turns the attachment filename into a product', () => {
    // "...HP 280 G9 - 25 Nos.docx" reads as a quantity of 25.
    for (const line of lines) {
      expect(line.desc).not.toContain('.docx')
      expect(line.desc).not.toContain('Quotation-DGSL')
    }
  })

  it('never turns a totals row into a product', () => {
    // "Total - Rs. 1,11,500 + gst each" would print the whole order as a line.
    for (const line of lines) {
      expect(line.desc.split('\n')[0]!.trim()).not.toMatch(/^total\b/i)
    }
    expect(offers.map((o) => o.rate)).not.toContain(11_150_000)
    expect(offers.map((o) => o.rate)).not.toContain(9_550_000)
  })

  it('keeps the product name when the description wrapped over three lines', () => {
    // The quantity landed on the last line of a wrapped description, so §5
    // named the product "Yrs Onsite Without Monitor" and threw the rest away.
    const desktop = requests.find((r) => r.qty === 25)
    expect(desktop?.desc.split('\n')[0]).toBe('HP Pro Tower 280 G9 PCI Desktop PC')
    expect(desktop?.desc).toContain('i5-13500/16GB DDR4/512GB SSD')

    const laptop = requests.find((r) => r.qty === 6)
    expect(laptop?.desc.split('\n')[0]).toBe('HP ProBook 440 14 inch G11 Notebook PC')
  })

  it('reads the four priced products the 17 June message actually lists', () => {
    expect(offers.map((o) => o.desc.split('\n')[0])).toEqual([
      'HP ProBook 4 G1iR 14 Notebook Probook/440 G11',
      '3 Years NBD and 3 Years ADP',
      'HP 280 G9 MT ( MII )',
      'Additional 8GB HP Memory',
    ])
    expect(offers.map((o) => o.rate)).toEqual([10_450_000, 700_000, 8_300_000, 1_250_000])
  })

  it('does not report mail client furniture as unread', () => {
    const joined = skipped.join(' | ')
    for (const chrome of [
      'Contact photo',
      'Details Plain text',
      '(~57 KB)',
      'Original Message',
      'Fwd:',
      'Quotation-DGSL',
    ]) {
      expect(joined, `"${chrome}" should not be reported`).not.toContain(chrome)
    }
  })
})

describe('a thread carrying several revisions of the same quotation', () => {
  it('says plainly that the prices came from a superseded message', () => {
    const { warnings } = parseThreadDetailed(DGSL_THREAD)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/more recent message/i)
    expect(warnings[0]).toMatch(/out of date/i)
    // The reason those messages produced nothing: their prices are in a pasted
    // table, which a line-based parser cannot reconstruct.
    expect(warnings[0]).toMatch(/table/i)
  })

  it('says nothing when the prices come from the newest message', () => {
    const { warnings } = parseThreadDetailed(SAMPLE_THREAD)
    expect(warnings).toEqual([])
  })
})

describe('numbers that were silently misread', () => {
  const parse1 = (line: string) =>
    parseThread(['On Thu, Jul 9, 2026 at 7:42 AM a <a@x.com> wrote:', line].join('\n'))

  it('reads a grouped quantity, instead of its first digit', () => {
    // "Qty- 1,000" matched the "1" and stopped: an order-of-magnitude error,
    // silent, on the one number this application exists to get right.
    expect(parse1('Cable - Rs. 50 each, Qty- 1,000')[0]?.qty).toBe(1000)
    expect(parse1('Cable - Rs. 50 each, Qty- 12,500')[0]?.qty).toBe(12500)
  })

  it('reads a quantity above four digits at all', () => {
    expect(parse1('Cable - Rs. 50 each, Qty- 10000')[0]?.qty).toBe(10000)
  })

  it('does not start a quantity in the middle of a number', () => {
    // "12,500 nos" matched at the "500" — the wrong half.
    expect(parse1('Cable - Rs. 50 each, 12,500 nos')[0]?.qty).toBe(12500)
  })

  it('rejects a number too large to be an order quantity', () => {
    // A phone number must not arrive as a count. 0 is the parser's "not
    // stated"; web/src/lib/draft.ts is what turns that into 1 on a quotation.
    expect(parse1('Cable - Rs. 50 each, Qty- 9,870,450,278')[0]?.qty).toBe(0)
  })

  it('reads the rate markers that Indian quotes actually use', () => {
    const cases: Array<[string, number]> = [
      ['Cable 1250 INR each', 125_000],
      ['Cable Rate 1250/-', 125_000],
      ['Cable @ 1250 each', 125_000],
      ['Cable 1,04,500/- each', 10_450_000],
      ['Cable Price: 1,250.50', 125_050],
      ['Cable - Rs. 1,250 each', 125_000],
    ]
    for (const [line, expected] of cases) {
      expect(parse1(line)[0]?.rate, line).toBe(expected)
    }
  })

  it('a priced line is an offer — a missed rate would flip it to a request', () => {
    expect(parse1('Cable 1250 INR each')[0]?.role).toBe('offer')
    expect(parse1('Cable Rate 1250/-')[0]?.role).toBe('offer')
  })

  it('never invents a rate from a bare number', () => {
    // Without a marker there is no telling 25 the price from 25 the quantity.
    expect(parse1('Cable 1.5 mtr, Qty- 25')[0]?.rate).toBe(0)
  })

  it('does not read "@ 5 nos" as a rate of five', () => {
    const line = parse1('Cable - Rs. 50 each @ 5 nos')[0]
    expect(line?.rate).toBe(5_000)
    expect(line?.qty).toBe(5)
  })

  it('does not read a rupee amount as a length', () => {
    // "Rs. 550 m" read as 550 metres and raised a spec flag against a line
    // whose only crime was being priced in rupees.
    expect(firstLength('Rs. 550 m')).toBeNull()
    expect(firstLength('INR 1,250 m')).toBeNull()
    // A real length still reads.
    expect(firstLength('Cable 1.5 m')).toBe(1.5)
    expect(firstLength('Cable 1.5 mtr - Rs. 550')).toBe(1.5)
  })
})
