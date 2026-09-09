import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from './customers.js'
import {
  INTERNAL_EMAIL_DOMAINS,
  mergeWithLedger,
  resolveCustomer,
  type ExtractedCustomer,
} from './extractCustomer.js'
import { rankCandidates } from './customerMatch.js'
import { clearReadCache, readThreadWithAi } from './readThread.js'

/**
 * Two questions, and keeping them apart is the point of this file.
 *
 * WHICH LEDGER — answered by rankCandidates, and answered with a LIST. The
 * desk's master is their Tally sundry debtors, where sixteen ledgers are some
 * spelling of "Datamatics Global Services Limited" and three Azentio sites
 * share a name and a GSTIN. Nothing may pick one of those on its own.
 *
 * WHAT THE DRAFT BECOMES once a person has picked — answered by
 * mergeWithLedger, which is the precedence table the old resolveCustomer held,
 * and is tested here field by field: what the thread said, what the ledger
 * holds, and which one is allowed to win.
 *
 * resolveCustomer now only routes between the two. No live model is involved
 * anywhere here: askAi is stubbed.
 */
const { askAi, allCustomers } = vi.hoisted(() => ({
  askAi: vi.fn(),
  allCustomers: vi.fn(),
}))
vi.mock('./ai.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai.js')>()),
  askAi,
}))

/**
 * The master is stubbed rather than seeded. What is under test is which
 * candidates the matcher offers and what the merge does with one; a real table
 * would only put SQL between the question and the answer, and the SQL is tested
 * where it lives.
 */
vi.mock('./customers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./customers.js')>()),
  allCustomers,
}))

beforeEach(() => {
  askAi.mockReset()
  // The reader remembers answers by thread text, and every test here uses the
  // same thread — without this the second one would read a cached answer meant
  // for the first.
  clearReadCache()
  allCustomers.mockReset().mockReturnValue([])
})

const read = (over: Partial<ExtractedCustomer> = {}): ExtractedCustomer => ({
  name: '',
  address: '',
  attention: '',
  gstin: '',
  state: '',
  confidence: 'high',
  ...over,
})

let nextId = 0
const file = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id: `c${++nextId}`,
  name: '',
  address: '',
  attention: '',
  gstin: '',
  state: '',
  contact: '',
  email: '',
  country: 'India',
  regType: 'Regular',
  source: 'tally',
  quoteCount: 1,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** The ledgers the master holds for a test, and what a read of them offers. */
const onFile = (...records: CustomerRecord[]) => {
  allCustomers.mockReturnValue(records)
  return records
}

const resolveAgainst = (extracted: ExtractedCustomer, records: CustomerRecord[] = []) =>
  resolveCustomer(extracted, rankCandidates(extracted, records))

// ---------------------------------------------------------------------------

describe('a name is not an identity', () => {
  /** Six real ledgers, three of which share one registration. */
  const AZENTIO = [
    file({ name: 'AZENTIO SOFTWARE PVT LTD (BANGALORE)', gstin: '29AAUCA4876F1Z0', state: 'Karnataka', address: 'Whitefield, Bengaluru' }),
    file({ name: 'AZENTIO SOFTWARE PVT LTD (CHENNAI)', gstin: '33AAUCA4876F1ZB', state: 'Tamil Nadu', address: 'Kandanchavadi, Chennai' }),
    file({ name: 'AZENTIO SOFTWARE PVT LTD (Ghansoli)', gstin: '27AAUCA4876F1Z4', state: 'Maharashtra', address: 'Aurum Q Parc, Navi Mumbai' }),
    file({ name: 'AZENTIO SOFTWARE PVT LTD (MALAD)', gstin: '27AAUCA4876F1Z4', state: 'Maharashtra', address: 'Sej Plaza, Malad West' }),
    file({ name: 'AZENTIO SOFTWARE PVT LTD (Vashi)', gstin: '27AAUCA4876F1Z4', state: 'Maharashtra', address: 'International Infotech Park, Vashi' }),
    file({ name: 'AZENTIO SOFTWARE PVT LTD (HYD)', gstin: '36AAUCA4876F1Z5', state: 'Telangana', address: 'Gachibowli, Hyderabad' }),
  ]

  it('offers every ledger the thread could mean rather than the best one', () => {
    const resolved = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...AZENTIO))
    expect(resolved.customerCandidates).toHaveLength(6)
  })

  it('fills NOTHING in while there is a choice to be made', () => {
    // The whole rule, in one assertion. Six ledgers with four different GSTINs
    // and five different states scored identically on the name; picking the
    // top one would be choosing a tax registration by coin toss.
    const resolved = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...AZENTIO))

    expect(resolved.customer.address).toBe('')
    expect(resolved.customer.gstin).toBe('')
    expect(resolved.customer.state).toBe('')
    expect(resolved.customer.attention).toBe('')
  })

  it('keeps the name the thread gave, so the question can be asked with it', () => {
    // The four fields that decide what prints and what tax applies stay blank;
    // the name is simply what the thread said, and the chooser needs it.
    const resolved = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...AZENTIO))
    expect(resolved.customer.name).toBe('Azentio Software Pvt Ltd')
  })

  it('still asks when only one ledger matches', () => {
    // One candidate is a shortlist of one, not an answer. Auto-applying here is
    // how the old matchOnFile behaved for every case, including the six above.
    const resolved = resolveAgainst(read({ name: 'Adminneeds' }), onFile(file({ name: 'Adminneeds', gstin: '27CSAPP2697G1ZE' })))

    expect(resolved.customerCandidates).toHaveLength(1)
    expect(resolved.customer.gstin).toBe('')
    expect(resolved.customerNote).toMatch(/nothing has been filled in/i)
  })

  it('says how many, and what actually separates them', () => {
    const resolved = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...AZENTIO))
    expect(resolved.customerNote).toMatch(/6 customers/)
    expect(resolved.customerNote).toMatch(/different GSTINs/)
  })

  it('says the address is the difference when the candidates share a GSTIN', () => {
    // Ghansoli, Malad and Vashi are one registration at three sites. Telling
    // the desk to check the GSTIN here would send them to the one field that
    // cannot distinguish these rows.
    const shared = AZENTIO.filter((r) => r.gstin === '27AAUCA4876F1Z4')
    const resolved = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...shared))

    expect(resolved.customerCandidates).toHaveLength(3)
    expect(resolved.customerNote).toMatch(/share a GSTIN/)
    expect(resolved.customerNote).toMatch(/address is what separates them/)
  })

  it('puts a ledger whose GSTIN the thread quoted at the top, without deciding', () => {
    const resolved = resolveAgainst(
      read({ name: 'Azentio Software Pvt Ltd', gstin: '33AAUCA4876F1ZB' }),
      onFile(...AZENTIO),
    )

    expect(resolved.customerCandidates[0]?.record.name).toContain('CHENNAI')
    expect(resolved.customerCandidates[0]?.gstinMatch).toBe(true)
    // ...and it is still a list. Three ledgers share one GSTIN on this very
    // list, so even an exact registration cannot always name one entity.
    expect(resolved.customerCandidates.length).toBeGreaterThan(1)
    expect(resolved.customer.gstin).toBe('')
  })

  it('carries what each candidate WOULD fill in, so choosing needs no round trip', () => {
    const resolved = resolveAgainst(
      read({ name: 'Azentio Software Pvt Ltd', attention: 'Ms. Priya Nair' }),
      onFile(...AZENTIO),
    )

    const malad = resolved.customerCandidates.find((c) => c.record.name.includes('MALAD'))!
    expect(malad.customer.address).toBe('Sej Plaza, Malad West')
    expect(malad.customer.gstin).toBe('27AAUCA4876F1Z4')
    expect(malad.customer.state).toBe('Maharashtra')
    // The thread's attention still beats the ledger's, per candidate.
    expect(malad.customer.attention).toBe('Ms. Priya Nair')
  })

  it('does not offer a company that merely shares a common word', () => {
    // Both are "Services Pvt Ltd", which is three tokens of boilerplate out of
    // four. Raw Dice scores this 0.75 — above the identity threshold the old
    // matcher used to APPLY a record silently.
    const resolved = resolveAgainst(
      read({ name: 'Foo Services Pvt Ltd' }),
      onFile(file({ name: 'Bar Services Pvt Ltd' })),
    )
    expect(resolved.customerCandidates).toEqual([])
  })

  it('does not offer a subsidiary that merely contains the parent name', () => {
    const resolved = resolveAgainst(
      read({ name: 'Datamatics Global Services Limited' }),
      onFile(file({ name: 'LUMINA DATAMATICS LIMITED (117)' })),
    )
    expect(resolved.customerCandidates).toEqual([])
  })

  it('does offer the sister entity that is genuinely easy to confuse', () => {
    // Datamatics Global Services and Datamatics Staffing Services are two real
    // companies with two real GSTINs. Showing both is the point: the moment to
    // notice they are different is while both are on screen.
    const resolved = resolveAgainst(
      read({ name: 'Datamatics Global Services Limited' }),
      onFile(
        file({ name: 'DATAMATICS GLOBAL SERVICES LIMITED. - 155', gstin: '27AAACD4471B3Z0' }),
        file({ name: 'DATAMATICS STAFFING SERVICES LIMITED. - COLABA', gstin: '27AAACD1111A1Z0' }),
      ),
    )

    expect(resolved.customerCandidates).toHaveLength(2)
    // ...and the exact one ranks first.
    expect(resolved.customerCandidates[0]?.record.name).toContain('GLOBAL')
  })

  it('ranks identically-scoring ledgers in a stable order', () => {
    // Three rows differing only by address score the same on everything a
    // matcher can see. A list that reshuffles between two reads of one thread
    // is a list nobody trusts.
    const shared = AZENTIO.filter((r) => r.gstin === '27AAUCA4876F1Z4')
    const once = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...shared))
    const twice = resolveAgainst(read({ name: 'Azentio Software Pvt Ltd' }), onFile(...shared))

    expect(once.customerCandidates.map((c) => c.record.id)).toEqual(
      twice.customerCandidates.map((c) => c.record.id),
    )
  })
})

describe('a company that is not on the list', () => {
  it('fills the draft from the thread when nothing could be meant', () => {
    // Quoting a company before Tally has it is ordinary and must stay
    // frictionless: there is nothing to choose between, so nothing is asked.
    const resolved = resolveAgainst(
      read({ name: 'Zensar', address: 'Kharadi, Pune', state: 'Maharashtra' }),
      onFile(file({ name: 'Blue Star Limited' })),
    )

    expect(resolved.customerCandidates).toEqual([])
    expect(resolved.customer.name).toBe('Zensar')
    expect(resolved.customer.address).toBe('Kharadi, Pune')
    expect(resolved.customerFrom).toBe('thread')
  })
})

describe('mergeWithLedger precedence', () => {
  it('lets the ledger win for address, GSTIN and state', () => {
    const { customer } = mergeWithLedger(
      read({
        name: 'Datamatics Global Services Ltd',
        address: 'Andheri East, Mumbai',
        gstin: '27AABCU9603R1ZM',
        state: 'Maharashtra',
      }),
      file({
        name: 'DATAMATICS GLOBAL SERVICES LIMITED. KC 1',
        address: 'Knowledge Park, Andheri East, Mumbai 400093',
        gstin: '27AAACD1234E1Z5',
        state: 'Maharashtra',
      }),
    )

    expect(customer.address).toBe('Knowledge Park, Andheri East, Mumbai 400093')
    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customer.state).toBe('Maharashtra')
  })

  it('always takes the ledger name, because that is what choosing decided', () => {
    // The thread's spelling is not a competing claim about who they are.
    // Letting it win would print "Datamatics" over a GSTIN, address and state
    // that all came from the KC 1 ledger.
    const { customer } = mergeWithLedger(
      read({ name: 'Datamatics Global Services Ltd' }),
      file({ name: 'DATAMATICS GLOBAL SERVICES LIMITED. KC 1' }),
    )
    expect(customer.name).toBe('DATAMATICS GLOBAL SERVICES LIMITED. KC 1')
  })

  it('lets the thread win for attention, inverting the rule for the other fields', () => {
    // The stored attention is whoever the last document was addressed to and
    // may be months stale; the thread is whoever is asking now.
    const { customer } = mergeWithLedger(
      read({ name: 'Datamatics', attention: 'Ms. Priya Nair' }),
      file({ name: 'Datamatics', attention: 'Mr. Mahesh Jathar' }),
    )
    expect(customer.attention).toBe('Ms. Priya Nair')
  })

  it('falls back to the stored attention when the thread names nobody', () => {
    const { customer } = mergeWithLedger(
      read({ name: 'Datamatics', attention: '' }),
      file({ name: 'Datamatics', attention: 'Mr. Mahesh Jathar' }),
    )
    expect(customer.attention).toBe('Mr. Mahesh Jathar')
  })

  it('never lets a blank overwrite a populated value, in either direction', () => {
    // An absence is not a statement that the field is empty. Blank on file must
    // not erase the thread's address; blank in the thread must not erase the
    // file's GSTIN — and a whitespace-only value is blank.
    const { customer } = mergeWithLedger(
      read({ name: 'Zensar', address: 'Kharadi, Pune', attention: '   ', gstin: '' }),
      file({ name: 'Zensar', address: '', attention: 'Mr. R Gupta', gstin: '27AAACD1234E1Z5' }),
    )

    expect(customer.address).toBe('Kharadi, Pune')
    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customer.attention).toBe('Mr. R Gupta')
  })
})

describe('resolveCustomer guards a fresh read', () => {
  it('drops a state that is not an Indian state and says so', () => {
    // "Bangalore" is a city. It reaches taxModeForState if it is let through,
    // and the tax treatment is decided by the state.
    const { customer, customerMissing, customerNote } = resolveAgainst(
      read({ name: 'Zensar', state: 'Bangalore' }),
    )

    expect(customer.state).toBe('')
    expect(customerMissing).toContain('Ship-to state')
    expect(customerNote).toMatch(/ship-to state/i)
  })

  it('accepts a state in any case and returns the list spelling', () => {
    const { customer, customerMissing, customerNote } = resolveAgainst(
      read({ name: 'Zensar', state: 'karnataka' }),
    )
    expect(customer.state).toBe('Karnataka')
    expect(customerMissing).not.toContain('Ship-to state')
    expect(customerNote).toBeUndefined()
  })

  it('drops a malformed GSTIN rather than putting half a number on a document', () => {
    const { customer, customerMissing, customerNote } = resolveAgainst(
      read({ name: 'Zensar', gstin: '27AABCU9603R' }),
    )

    expect(customer.gstin).toBe('')
    expect(customerMissing).toContain('GSTIN')
    expect(customerNote).toMatch(/GSTIN/)
  })

  it('normalises case and spacing on a GSTIN that is otherwise well formed', () => {
    const { customer } = resolveAgainst(read({ name: 'Zensar', gstin: ' 27aabcu9603r1zm ' }))
    expect(customer.gstin).toBe('27AABCU9603R1ZM')
  })

  it('names every field blank in both sources, and reports a read that found nothing', () => {
    // Distinct from a read that FAILED, which the route reports as a null
    // customer — see AiReadResponseSchema.
    const resolved = resolveAgainst(read({ confidence: 'low' }))

    expect(resolved.customer).toEqual({
      name: '',
      address: '',
      attention: '',
      gstin: '',
      state: '',
    })
    expect(resolved.customerMissing).toEqual([
      'Customer',
      'Address',
      'Kind attention',
      'GSTIN',
      'Ship-to state',
    ])
    expect(resolved.customerConfidence).toBe('low')
  })
})

describe('the internal-domain guard', () => {
  it('knows both of our mail domains, from one list', () => {
    // The prompt and rejectOwnDetails read the same array, so widening it is
    // one edit rather than a second spelling buried in a regex.
    expect(INTERNAL_EMAIL_DOMAINS).toContain('newtech.in')
    expect(INTERNAL_EMAIL_DOMAINS).toContain('newtech.co.in')
  })

  it('blanks a read that came back with our own co.in signature', async () => {
    // Nothing here says "newtech" in the name and the address is not Saki
    // Vihar, so the older guard let this through — onto a quotation addressed
    // to us.
    askAi.mockResolvedValue({
      ok: true,
      data: {
        lines: [],
        customer: {
          name: 'Solaris Trading',
          address: 'Unit 4, Powai, Mumbai\nsales@newtech.co.in',
          attention: 'Mr. R Gupta',
          gstin: '27AABCU9603R1ZM',
          state: 'Maharashtra',
          confidence: 'high',
        },
      },
    })

    const result = await readThreadWithAi('Please quote 10 x MK540.')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.extracted).toEqual({
      name: '',
      address: '',
      attention: '',
      gstin: '',
      state: '',
      confidence: 'low',
    })
    // A blank name means the master is never consulted, so no ledger can be
    // offered for a customer we just refused to identify.
    expect(result.data.candidates).toEqual([])
  })
})

describe('mergeWithLedger guards what is already on file', () => {
  it('checks a stored GSTIN rather than trusting it for being old', () => {
    // The ledger WINS for the GSTIN, so an unchecked stored value is the one
    // that reaches the document. Somebody saving a quotation with it months ago
    // is not the same as anybody having looked at it.
    const { customer, note } = mergeWithLedger(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', gstin: '27AABCU9603R' }),
    )

    expect(customer.gstin).toBe('')
    // ...and it says whose GSTIN went missing. Dropping a stored value in
    // silence is the same bug as dropping a read one in silence, and nobody has
    // the customer list open while a quotation is being made.
    expect(note).toMatch(/GSTIN/)
    expect(note).toMatch(/customer list/i)
  })

  it('drops a stored state that is not an Indian state and says so', () => {
    // The ship-to state decides the tax split, whichever side it arrived from.
    const { customer, note } = mergeWithLedger(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', state: 'Bangalore' }),
    )

    expect(customer.state).toBe('')
    expect(note).toMatch(/ship-to state/i)
  })

  it('falls back to the thread when the stored GSTIN is the bad one', () => {
    const { customer } = mergeWithLedger(
      read({ name: 'Zensar', gstin: '27AABCU9603R1ZM' }),
      file({ name: 'Zensar', gstin: 'GSTIN PENDING' }),
    )
    expect(customer.gstin).toBe('27AABCU9603R1ZM')
  })

  it('normalises a well-formed stored value instead of rejecting it', () => {
    // The guards normalise case and spacing, so running them over the stored
    // side costs a badly typed record nothing and says nothing about it.
    const { customer, note } = mergeWithLedger(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', gstin: ' 27aabcu9603r1zm ', state: 'karnataka' }),
    )

    expect(customer.gstin).toBe('27AABCU9603R1ZM')
    expect(customer.state).toBe('Karnataka')
    expect(note).toBeUndefined()
  })
})

describe('mergeWithLedger says what it overruled', () => {
  it('names the thread values the ledger beat', () => {
    // A customer who has moved office: the new address is in the thread, last
    // year's is on file, and the file wins. Nothing reviews this on screen, so
    // the disagreement has to travel with the candidate.
    const { customer, conflicts, note } = mergeWithLedger(
      read({
        name: 'Zensar',
        address: 'Amar Tech Park, Balewadi, Pune',
        gstin: '27AABCU9603R1ZM',
      }),
      file({
        name: 'Zensar',
        address: 'Kharadi, Pune 411014',
        gstin: '27AAACD1234E1Z5',
      }),
    )

    expect(customer.address).toBe('Kharadi, Pune 411014')
    expect(conflicts).toEqual(['Address', 'GSTIN'])
    expect(note).toMatch(/different Address and GSTIN/)
    expect(note).toMatch(/customer list/i)
  })

  it('says it the other way round for the field the thread wins', () => {
    const { customer, conflicts, note } = mergeWithLedger(
      read({ name: 'Zensar', attention: 'Ms. Priya Nair' }),
      file({ name: 'Zensar', attention: 'Mr. R Gupta' }),
    )

    expect(customer.attention).toBe('Ms. Priya Nair')
    expect(conflicts).toEqual(['Kind attention'])
    expect(note).toMatch(/^Your customer list gives a different Kind attention/)
  })

  it('never calls the name a disagreement', () => {
    // Every branch ledger is spelled differently from how a thread writes the
    // company. Flagging it would fire on nearly every quotation, which is how
    // a desk learns to stop reading these.
    const { conflicts } = mergeWithLedger(
      read({ name: 'Azentio Software Pvt Ltd' }),
      file({ name: 'AZENTIO SOFTWARE PVT LTD (MALAD)' }),
    )
    expect(conflicts).toEqual([])
  })

  it('stays quiet when the two sources differ only in typing', () => {
    // A note that fires on capitals and double spaces is noise, and noise is
    // what teaches people to stop reading the notes.
    const { conflicts, note } = mergeWithLedger(
      read({ name: 'zensar   technologies', address: 'Kharadi,  Pune' }),
      file({ name: 'Zensar Technologies', address: 'Kharadi, Pune' }),
    )

    expect(conflicts).toEqual([])
    expect(note).toBeUndefined()
  })

  it('does not call a blank on either side a disagreement', () => {
    const { conflicts } = mergeWithLedger(
      read({ name: 'Zensar', address: 'Kharadi, Pune' }),
      file({ name: 'Zensar', address: '', attention: 'Mr. R Gupta' }),
    )
    expect(conflicts).toEqual([])
  })
})

describe('mergeWithLedger repairs a stored address that lost its line breaks', () => {
  /**
   * The real record. Two lines were saved into one at some point in the past —
   * "Sec 44Gurugram", no separator at all — and on-file precedence then printed
   * it that way on every quotation for that customer, each save handing the
   * broken value straight back.
   *
   * Rarer since the debtors import: it rebuilds the line structure Tally's
   * export flattens. A row the master taught itself from an old save can still
   * be in this state.
   */
  const RUN_TOGETHER = 'Plot 66, Sec 44Gurugram, Haryana - 122001'
  const WITH_BREAK = 'Plot 66, Sec 44\nGurugram, Haryana - 122001'

  it('takes the fresh read when the stored copy is the same address flattened', () => {
    const { customer } = mergeWithLedger(
      read({ name: 'Zensar', address: WITH_BREAK }),
      file({ name: 'Zensar', address: RUN_TOGETHER }),
    )
    expect(customer.address).toBe(WITH_BREAK)
  })

  it('calls it a repair rather than a disagreement', () => {
    const { conflicts, note } = mergeWithLedger(
      read({ name: 'Zensar', address: WITH_BREAK }),
      file({ name: 'Zensar', address: RUN_TOGETHER }),
    )

    expect(conflicts).toEqual([])
    expect(note).toMatch(/line breaks/)
  })

  it('leaves the ledger winning when the addresses genuinely differ', () => {
    const { customer } = mergeWithLedger(
      read({ name: 'Zensar', address: 'Amar Tech Park, Balewadi\nPune 411045' }),
      file({ name: 'Zensar', address: 'Kharadi, Pune 411014' }),
    )
    expect(customer.address).toBe('Kharadi, Pune 411014')
  })

  it('does not let a flattened READ displace a stored address that has its breaks', () => {
    const { customer } = mergeWithLedger(
      read({ name: 'Zensar', address: RUN_TOGETHER }),
      file({ name: 'Zensar', address: WITH_BREAK }),
    )
    expect(customer.address).toBe(WITH_BREAK)
  })
})
