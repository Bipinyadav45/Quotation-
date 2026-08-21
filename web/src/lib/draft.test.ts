import { describe, expect, it } from 'vitest'
import type { ParsedLine, QuoteItem } from '@shared/schema'
import { PRICES_GST_EXTRA, hoistWarranty, itemsFromLines, pricesTermFromLines } from './draft.js'

const line = (over: Partial<ParsedLine>): ParsedLine => ({
  id: 'x',
  raw: '',
  desc: 'Widget',
  make: '',
  partCode: '',
  qty: 0,
  rate: 0,
  role: 'offer',
  source: 'pattern',
  ...over,
})

describe('quantity when the thread never stated one', () => {
  it('is 1, not 0 — 0 prices the line at nothing and zeroes the total', () => {
    const { items } = itemsFromLines([line({ qty: 0, rate: 10_450_000 })])
    expect(items[0]!.qty).toBe(1)
    expect(items[0]!.qty * items[0]!.rate).toBe(10_450_000)
  })

  it('never overrides a quantity the thread did state', () => {
    const { items } = itemsFromLines([line({ qty: 25, rate: 8_300_000 })])
    expect(items[0]!.qty).toBe(25)
  })

  it('counts what it assumed, so the screen can say so', () => {
    const { assumedQty } = itemsFromLines([
      line({ qty: 0, rate: 100 }),
      line({ qty: 0, rate: 200 }),
      line({ qty: 4, rate: 300 }),
    ])
    expect(assumedQty).toBe(2)
  })

  it('assumes nothing when every line stated a quantity', () => {
    const { assumedQty } = itemsFromLines([line({ qty: 2, rate: 100 })])
    expect(assumedQty).toBe(0)
  })
})

describe('which lines become the quotation', () => {
  it('quotes the priced lines when the thread has any', () => {
    const { items } = itemsFromLines([
      line({ desc: 'Dock', qty: 0, rate: 275_000 }),
      line({ desc: 'Dock', qty: 1, rate: 0, role: 'request' }),
    ])
    // Listing both would put a zero-priced duplicate on the quotation.
    expect(items).toHaveLength(1)
    expect(items[0]!.rate).toBe(275_000)
  })

  it('lists what it set aside rather than dropping it, quantity included', () => {
    const { setAside } = itemsFromLines([
      line({ desc: 'Dock', rate: 275_000 }),
      line({ desc: 'HP Pro Tower 280 G9', qty: 25, rate: 0, role: 'request' }),
    ])
    // That quantity is often the only place the customer stated one.
    expect(setAside).toEqual(['HP Pro Tower 280 G9  (qty 25)'])
  })

  it('quotes every line when nothing in the thread carries a price', () => {
    const { items, setAside } = itemsFromLines([
      line({ desc: 'desktop', qty: 4, rate: 0, role: 'request' }),
      line({ desc: 'tft', qty: 0, rate: 0, role: 'request' }),
    ])
    expect(items.map((i) => i.desc)).toEqual(['desktop', 'tft'])
    expect(items.map((i) => i.qty)).toEqual([4, 1])
    expect(setAside).toEqual([])
  })

  it('takes only the first line of a multi-line description into the set-aside list', () => {
    const { setAside } = itemsFromLines([
      line({ desc: 'Dock', rate: 100 }),
      line({ desc: 'HP Pro Tower\ni5-13500/16GB DDR4', qty: 25, rate: 0, role: 'request' }),
    ])
    expect(setAside).toEqual(['HP Pro Tower  (qty 25)'])
  })
})

/**
 * The descriptions below are the parsed §11 fixture and the parsed DGSL chain,
 * verbatim from server/src/lib/parser.test.ts. Written out rather than parsed
 * here so the rule is tested on its own, but they are the real threads: the
 * quantities are the ones on the real documents, and the scores quoted in the
 * comments are the ones these strings actually produce.
 */
const USB_C_OFFER = 'Black i USB-C to USB-C 1.5 mtr'
const USB_A_REQUEST = 'Black i USB-C to USB-A 1.5 mtr'
const USB_C_SHORT_REQUEST = 'Black i USB-C to USB-C 1 mtr'

const PROBOOK_OFFER =
  'HP ProBook 4 G1iR 14 Notebook Probook/440 G11\n' +
  'U5-125U/16GB/1TB SSD/FHD 300 Nits/BLK/FPR/MII/Win 11 Pro/1 Yr Onsite/ Bag'
const PROBOOK_REQUEST =
  'HP ProBook 440 14 inch G11 Notebook PC\n' +
  'ProBook/440 G11/U5-125U/16GB/1TB SSD/FHD 300\n' +
  'Nits/BLK/FPR/MII/Win 11 Pro/3 Yr Onsite with ADP'
const G9_OFFER =
  'HP 280 G9 MT ( MII )\n' +
  'Core i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, , Win 11 Pro., 3 Years Warranty.'
const G9_REQUEST =
  'HP Pro Tower 280 G9 PCI Desktop PC\n' +
  'i5-13500/16GB DDR4/512GB SSD/Wi-Fi/MII/Win11Pro/3\nYrs Onsite Without Monitor'

describe('a quantity carried over from the customer’s own request line', () => {
  it('takes the quantity off the matching request instead of assuming 1', () => {
    // The DGSL document says "HP ProBook - 06 Nos."; the priced line never did.
    const { items } = itemsFromLines([
      line({ desc: PROBOOK_OFFER, qty: 0, rate: 10_450_000 }),
      line({ desc: G9_REQUEST, qty: 25, rate: 0, role: 'request' }),
      line({ desc: PROBOOK_REQUEST, qty: 6, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(6)
    expect(items[0]!.qty * items[0]!.rate).toBe(62_700_000)
  })

  it('says which request line the quantity came from', () => {
    const { warnings } = itemsFromLines([
      line({ desc: PROBOOK_OFFER, qty: 0, rate: 10_450_000 }),
      line({ desc: PROBOOK_REQUEST, qty: 6, rate: 0, role: 'request' }),
    ])
    // A quantity worked out by software must never reach a customer unsaid,
    // and the warning has to say which line it was worked out from.
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('6 has been taken from the request line')
    expect(warnings[0]).toContain('HP ProBook 440 14 inch G11 Notebook PC')
  })

  it('does not count a carried quantity as one it assumed', () => {
    // assumedQty drives "set to 1, check it" — a different thing to report.
    const { assumedQty, items } = itemsFromLines([
      line({ desc: PROBOOK_OFFER, qty: 0, rate: 10_450_000 }),
      line({ desc: 'Carry bag', qty: 0, rate: 150_000 }),
      line({ desc: PROBOOK_REQUEST, qty: 6, rate: 0, role: 'request' }),
    ])
    expect(items.map((i) => i.qty)).toEqual([6, 1])
    expect(assumedQty).toBe(1)
  })

  it('reads a unit the writer left off — "14 Notebook" against "14 inch"', () => {
    // The two descriptions differ by exactly `14` against `14in`, which is the
    // one latitude the variant test allows. Demanding identical markers, as
    // price memory does, would refuse the DGSL pairing outright.
    const { items, warnings } = itemsFromLines([
      line({ desc: 'HP ProBook 440 14 Notebook PC', qty: 0, rate: 10_450_000 }),
      line({ desc: 'HP ProBook 440 14 inch Notebook PC', qty: 6, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(6)
    expect(warnings).toHaveLength(1)
  })
})

describe('a pairing that would take the wrong variant’s quantity', () => {
  it('refuses the 0.909 mis-pair the §11 thread produces, and stays at 1', () => {
    // "USB-C to USB-C 1.5 mtr" scores 0.909 against the USB-A request — higher
    // than anything else in the thread, and the wrong cable.
    const { items, assumedQty } = itemsFromLines([
      line({ desc: USB_C_OFFER, qty: 0, rate: 85_000 }),
      line({ desc: USB_A_REQUEST, qty: 2, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(items[0]!.qty * items[0]!.rate).toBe(85_000)
    expect(assumedQty).toBe(1)
  })

  it('names the request it refused, so the desk can decide', () => {
    const { warnings } = itemsFromLines([
      line({ desc: USB_C_OFFER, qty: 0, rate: 85_000 }),
      line({ desc: USB_A_REQUEST, qty: 2, rate: 0, role: 'request' }),
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(USB_A_REQUEST)
    expect(warnings[0]).toContain('has not been used')
  })

  it('does not fall through to the runner-up when the best match is refused', () => {
    // The 1 mtr request scores 0.800 — second place, and a different cable
    // again. Promoting it would put 3 on the quotation.
    const { items } = itemsFromLines([
      line({ desc: USB_C_OFFER, qty: 0, rate: 85_000 }),
      line({ desc: USB_A_REQUEST, qty: 2, rate: 0, role: 'request' }),
      line({ desc: USB_C_SHORT_REQUEST, qty: 3, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
  })

  it('refuses a request that asks for a different specification', () => {
    // 8GB DDR5 offered against a request for 16GB DDR4: close wording, and not
    // the same machine. The DGSL document carries 25 of it, which is a decision
    // for the desk and not for this.
    const { items, warnings, assumedQty } = itemsFromLines([
      line({ desc: G9_OFFER, qty: 0, rate: 8_300_000 }),
      line({ desc: G9_REQUEST, qty: 25, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(assumedQty).toBe(1)
    expect(warnings[0]).toContain('HP Pro Tower 280 G9 PCI Desktop PC')
    expect(warnings[0]).toContain('(qty 25)')
  })

  it('refuses a model number that differs only in its digits — MK540 against MK270', () => {
    // §11 prices the Logitech set as "#MK540". Neither code is hyphenated nor
    // starts with a digit, so with no marker between them the two keyboards
    // read as one product and the 4 walks onto the wrong one.
    const { items, assumedQty, warnings } = itemsFromLines([
      line({ desc: 'Logitech Wireless Keyboard and Mouse Set #MK540', qty: 0, rate: 345_000 }),
      line({
        desc: 'Logitech Wireless Keyboard and Mouse Set #MK270',
        qty: 4,
        rate: 0,
        role: 'request',
      }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(assumedQty).toBe(1)
    expect(warnings[0]).toContain('specifies a different variant')
  })

  it('refuses the generation the DGSL laptop turns on — 440 G11 against 440 G10', () => {
    // The shared 440 was the only marker the rule could see, and a G10 is a
    // year-older machine at a different price.
    const { items, assumedQty } = itemsFromLines([
      line({ desc: 'HP ProBook 440 14 inch G11 Notebook PC', qty: 0, rate: 10_450_000 }),
      line({ desc: 'HP ProBook 440 14 inch G10 Notebook PC', qty: 6, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(assumedQty).toBe(1)
  })

  it('says nothing when no request comes close at all', () => {
    const { items, assumedQty, warnings } = itemsFromLines([
      line({ desc: 'Dock', qty: 0, rate: 275_000 }),
      line({ desc: 'Logitech Wireless Keyboard and Mouse Set', qty: 4, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(assumedQty).toBe(1)
    expect(warnings).toEqual([])
  })

  it('takes nothing from a request that has no quantity either', () => {
    const { items, assumedQty, warnings } = itemsFromLines([
      line({ desc: 'tft', qty: 0, rate: 675_000 }),
      line({ desc: 'tft', qty: 0, rate: 0, role: 'request' }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(assumedQty).toBe(1)
    expect(warnings).toEqual([])
  })

  it('takes a quantity from a request, never from another priced line', () => {
    // Two things we are quoting are two things, however alike they read.
    const { items, warnings } = itemsFromLines([
      line({ desc: 'HP 22" TFT', qty: 0, rate: 675_000 }),
      line({ desc: 'HP 22" TFT', qty: 8, rate: 680_000 }),
    ])
    expect(items[0]!.qty).toBe(1)
    expect(warnings).toEqual([])
  })

  it('does not pair an incoming RFQ against itself', () => {
    // Nothing is priced, so every line is quoted — including the requests it
    // would otherwise match at 1.0 and take its own quantity from.
    const { items, assumedQty, warnings } = itemsFromLines([
      line({ desc: 'desktop with 16 gb ram', qty: 4, rate: 0, role: 'request' }),
      line({ desc: 'tft', qty: 0, rate: 0, role: 'request' }),
    ])
    expect(items.map((i) => i.qty)).toEqual([4, 1])
    expect(assumedQty).toBe(1)
    expect(warnings).toEqual([])
  })
})

describe('the prices term — term 3', () => {
  it('reads "+ gst" off the priced line, verbatim from the §11 thread', () => {
    const lines = [
      line({
        desc: USB_A_REQUEST,
        raw: 'Black i USB-C to USB-A 1.5 mtr, Qty- 02 -  Rs. 550 + gst each',
        qty: 2,
        rate: 55_000,
      }),
    ]
    // "All-inclusive as per the quote" is not what this thread offered.
    expect(pricesTermFromLines(lines)).toBe(PRICES_GST_EXTRA)
  })

  it('reads the other spellings threads use', () => {
    for (const raw of [
      'HP 22" TFT - Rs. 6,750 + gst each',
      'Dock - Rs. 2750+ gst each',
      'Dock - Rs. 2,750 plus gst',
      'Dock - Rs. 2,750, gst extra',
      'Dock - Rs. 2,750, GST @ 18% extra',
      'Dock - Rs. 2,750 exclusive of gst',
      'Dock - Rs. 2,750 excluding GST',
    ]) {
      expect(pricesTermFromLines([line({ raw, rate: 275_000 })]), raw).toBe(PRICES_GST_EXTRA)
    }
  })

  it('keeps the default when the thread never says how GST was priced', () => {
    const lines = [line({ raw: 'Black i USB-C to USB-A 1.5 mtr, Qty- 02 - Rs. 550', rate: 55_000 })]
    expect(pricesTermFromLines(lines)).toBeNull()
  })

  it('keeps the default when the thread prices inclusive of GST', () => {
    const lines = [line({ raw: 'Dock - Rs. 2,750 inclusive of GST', rate: 275_000 })]
    expect(pricesTermFromLines(lines)).toBeNull()
  })

  it('reads only the lines being quoted, not the customer asking for a price', () => {
    // "Quote us + gst" is an instruction about a quotation not yet written.
    const lines = [
      line({ raw: 'Pls quote 4 nos desktop, rates + gst', qty: 4, rate: 0, role: 'request' }),
    ]
    expect(pricesTermFromLines(lines)).toBeNull()
  })

  it('says so if any one rate on the document excludes GST', () => {
    const lines = [
      line({ raw: 'Dock - Rs. 2,750', rate: 275_000 }),
      line({ raw: 'Cable - Rs. 550 + gst each', rate: 55_000 }),
    ]
    expect(pricesTermFromLines(lines)).toBe(PRICES_GST_EXTRA)
  })
})

describe('two priced lines answering one request line', () => {
  // "We can do the Logitech or the HP, 25 of whichever you pick" — one stated
  // quantity, two options priced against it.
  const REQUEST = 'Wireless Keyboard and Mouse Set'
  const LOGITECH_OFFER = 'Logitech Wireless Keyboard and Mouse Set'
  const HP_OFFER = 'HP Wireless Keyboard and Mouse Set'

  const twoOptions = () =>
    itemsFromLines([
      line({ desc: LOGITECH_OFFER, qty: 0, rate: 345_000 }),
      line({ desc: HP_OFFER, qty: 0, rate: 195_000 }),
      line({ desc: REQUEST, qty: 25, rate: 0, role: 'request' }),
    ])

  it('gives the quantity to one of them, never to both', () => {
    // 25 on both lines orders 50 keyboards against a request for 25.
    const { items, assumedQty } = twoOptions()
    expect(items.map((i) => i.qty)).toEqual([25, 1])
    expect(assumedQty).toBe(1)
  })

  it('says both lines answer the one request, and leaves the split to the desk', () => {
    // Software cannot know whether the customer wants 25 of each or 25 split
    // between them, so it must refuse and say why.
    const { warnings } = twoOptions()
    expect(warnings).toHaveLength(2)
    expect(warnings[1]).toContain(HP_OFFER)
    expect(warnings[1]).toContain(REQUEST)
    expect(warnings[1]).toContain(LOGITECH_OFFER)
    expect(warnings[1]).toContain('Two priced lines answer one request')
  })

  it('still answers each request when the two priced lines answer two of them', () => {
    // The refusal is per request line, not one carry-over per thread.
    const { items, assumedQty } = itemsFromLines([
      line({ desc: LOGITECH_OFFER, qty: 0, rate: 345_000 }),
      line({ desc: 'Black i USB Type C Docking Station', qty: 0, rate: 275_000 }),
      line({ desc: REQUEST, qty: 25, rate: 0, role: 'request' }),
      line({ desc: 'USB Type C Docking Station', qty: 4, rate: 0, role: 'request' }),
    ])
    expect(items.map((i) => i.qty)).toEqual([25, 4])
    expect(assumedQty).toBe(0)
  })
})

/**
 * Term 5 — the warranty, taken out of the descriptions the desk wrote it in.
 *
 * The fixtures are the real ones again. G9_OFFER above is the DGSL desktop,
 * carrying ", 3 Years Warranty." on the end of its specification; NBD_EXTENSION
 * is the priced line beside it in the same message, which the customer is
 * billed 7,000 for. The refurbished drive is the line off the printed document
 * that started this, with the warranty on a line of its own.
 */
const NBD_EXTENSION = '3 Years NBD and 3 Years ADP'
const SAS_DRIVE = '1.6 TB SAS 12G Drive (Refurbished)\nWarranty: 1 Year'
const HP_DESKTOP =
  'HP 280 G9 MT Desktop\n' +
  'Core i5-14400, 16 GB RAM, 512GB SSD, Wi-Fi, Onboard , Win 11 Pro., 3 Years Warranty'

const item = (desc: string, over: Partial<QuoteItem> = {}): QuoteItem => ({
  desc,
  make: '',
  partCode: '',
  qty: 1,
  rate: 8_300_000,
  ...over,
})

describe('the warranty term — term 5', () => {
  it('takes a warranty written on a line of its own', () => {
    const { warranty, items } = hoistWarranty([item(SAS_DRIVE)])
    expect(warranty).toBe('1 Year')
    // The product name alone is a complete description, and it keeps no blank
    // line where the sentence used to be.
    expect(items[0]!.desc).toBe('1.6 TB SAS 12G Drive (Refurbished)')
  })

  it('drops that line without leaving the blank it filled behind', () => {
    // The shape server/src/lib/docx.test.ts renders: a specification of its
    // own, and the warranty on a line beneath it.
    const { warranty, items } = hoistWarranty([
      item('HP 280 G9 MT ( MII )\nCore i5-14500, 8GB DDR5\n3 Years Warranty'),
    ])
    expect(warranty).toBe('3 Years')
    expect(items[0]!.desc).toBe('HP 280 G9 MT ( MII )\nCore i5-14500, 8GB DDR5')
  })

  it('takes the trailing clause off a specification and leaves the rest reading properly', () => {
    const { warranty, items } = hoistWarranty([item(G9_OFFER), item(HP_DESKTOP)])
    expect(warranty).toBe('3 Years')
    // The ", ," is the thread's own, and was there before this ran. Removing a
    // warranty is not licence to rewrite a specification.
    expect(items[0]!.desc).toBe(
      'HP 280 G9 MT ( MII )\n' +
        'Core i5-14500, 8GB DDR5, 512GB SSD, Wi-Fi, Onboard, , Win 11 Pro.',
    )
    expect(items[1]!.desc).toBe(
      'HP 280 G9 MT Desktop\nCore i5-14400, 16 GB RAM, 512GB SSD, Wi-Fi, Onboard , Win 11 Pro.',
    )
  })

  it('removes it from the description rather than copying it', () => {
    // Left in place it prints twice on one page: once in the line, once as term 5.
    for (const desc of [SAS_DRIVE, G9_OFFER, HP_DESKTOP]) {
      const { warranty, items } = hoistWarranty([item(desc)])
      expect(warranty, desc).not.toBeNull()
      expect(items[0]!.desc, desc).not.toMatch(/warrant/i)
    }
  })

  it('tidies the separator wherever in the list the clause sat', () => {
    const { items } = hoistWarranty([
      item('Drive\nWarranty: 1 Year, 512GB SSD'),
      item('Drive\nCore i5, 1 Year Warranty, 512GB SSD'),
      item('Drive\nCore i5, 1 Year Warranty,'),
    ])
    expect(items.map((i) => i.desc)).toEqual([
      'Drive\n512GB SSD',
      'Drive\nCore i5, 512GB SSD',
      'Drive\nCore i5',
    ])
  })

  it('counts two spellings of one warranty as one, and prints the desk’s own words', () => {
    const { warranty, items, warnings } = hoistWarranty([
      item(HP_DESKTOP),
      item('HP 22" TFT\n21.5 inch, Warranty : 3 yrs.'),
    ])
    // Compared normalised, printed in the desk's own words: the length is the
    // sentence somebody actually wrote, and only the label the document
    // prints for itself comes off.
    expect(warranty).toBe('3 Years')
    expect(items[1]!.desc).toBe('HP 22" TFT\n21.5 inch')
    expect(warnings).toEqual([])
  })

  it('hoists nothing when two lines state different warranties', () => {
    const given = [item(G9_OFFER), item(SAS_DRIVE)]
    const { warranty, items, warnings } = hoistWarranty(given)
    // One term cannot say both, and a drive with a year on it must not come
    // out of this with three.
    expect(warranty).toBeNull()
    expect(items.map((i) => i.desc)).toEqual([G9_OFFER, SAS_DRIVE])
    expect(given.map((i) => i.desc)).toEqual([G9_OFFER, SAS_DRIVE])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"3 Years"')
    expect(warnings[0]).toContain('"1 Year"')
    expect(warnings[0]).toContain('HP 280 G9 MT ( MII )')
    expect(warnings[0]).toContain('1.6 TB SAS 12G Drive (Refurbished)')
  })

  it('says how many lines stated it when the others are silent', () => {
    const { warranty, items, warnings } = hoistWarranty([item(G9_OFFER), item('HP 22" TFT')])
    // Promoting one line's promise to cover the document is a claim nobody
    // made, so it is hoisted and it is said out loud.
    expect(warranty).toBe('3 Years')
    expect(items[1]!.desc).toBe('HP 22" TFT')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('1 of the 2 lines states a warranty')
    expect(warnings[0]).toContain('"3 Years"')
  })

  it('says nothing at all when no line states a warranty', () => {
    // Existing quotations are all of them this case, and must come back as
    // they went in — a blank "5. Warranty :" is worse than four terms.
    const { warranty, items, warnings } = hoistWarranty([
      item('HP 22" TFT'),
      item(PROBOOK_OFFER),
      item(USB_C_OFFER),
    ])
    expect(warranty).toBeNull()
    expect(items.map((i) => i.desc)).toEqual(['HP 22" TFT', PROBOOK_OFFER, USB_C_OFFER])
    expect(warnings).toEqual([])
  })

  it('gives a description with no warranty back byte for byte, hoist or no hoist', () => {
    // The ProBook's "1 Yr Onsite" sits inside a slash-separated HP spec string.
    // It is not a warranty clause, and a spec is not something to go editing on
    // the strength of a guess.
    const { items } = hoistWarranty([item(G9_OFFER), item(PROBOOK_OFFER)])
    expect(items[1]!.desc).toBe(PROBOOK_OFFER)
  })
})

describe('the priced line that is itself a warranty', () => {
  it('never touches the DGSL "3 Years NBD and 3 Years ADP" line', () => {
    // A billable warranty extension at 7,000 a machine. Read as a term it
    // loses its name, and 7,000 stays on the quotation with nothing beside it.
    const { warranty, items } = hoistWarranty([
      item(NBD_EXTENSION, { rate: 700_000 }),
      item(G9_OFFER),
    ])
    expect(items[0]!.desc).toBe(NBD_EXTENSION)
    expect(items[0]!.rate).toBe(700_000)
    expect(warranty).toBe('3 Years')
    expect(warranty).not.toContain('NBD')
  })

  it('leaves a name-only line alone even when the name reads as a warranty statement', () => {
    // The first line is the product name, whatever it says.
    const { warranty, items, warnings } = hoistWarranty([
      item('Warranty: 1 Year', { rate: 700_000 }),
    ])
    expect(warranty).toBeNull()
    expect(items[0]!.desc).toBe('Warranty: 1 Year')
    expect(warnings).toEqual([])
  })
})

describe('what is not a warranty statement', () => {
  it('leaves a bare "Warranty" with nothing after it where it is', () => {
    // Nothing was stated, so nothing can be printed: the same rule that leaves
    // a quantity the thread never gave at 0.
    const desc = 'Drive\nCore i5, Warranty'
    const { warranty, items } = hoistWarranty([item(desc)])
    expect(warranty).toBeNull()
    expect(items[0]!.desc).toBe(desc)
  })

  it('does not take the specification with it when the warranty is not its own clause', () => {
    // "Win 11 Pro. 3 Years Warranty" is one clause. Matching anything that ends
    // in the word would delete a specification in order to move a warranty, so
    // this line counts as one that stated nothing.
    const desc = 'HP 280 G9 MT Desktop\nCore i5-14400, Win 11 Pro. 3 Years Warranty'
    const { warranty, items } = hoistWarranty([item(desc)])
    expect(warranty).toBeNull()
    expect(items[0]!.desc).toBe(desc)
  })
})
