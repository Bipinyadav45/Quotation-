import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomerRecord } from './customers.js'
import {
  INTERNAL_EMAIL_DOMAINS,
  extractCustomerFromThread,
  resolveCustomer,
  type ExtractedCustomer,
} from './extractCustomer.js'

/**
 * resolveCustomer is the last thing between a model's reading of an email
 * footer and a GSTIN printed on a tax document — nothing reviews it on screen
 * any more. So it is tested as a precedence table: for each field, what the
 * thread said, what the file holds, and which one is allowed to win.
 *
 * No live model is involved anywhere here: askAi is stubbed, and the guard
 * test below only asks what the guard does with an answer.
 */
const { askAi, findCustomerByName, searchCustomers } = vi.hoisted(() => ({
  askAi: vi.fn(),
  findCustomerByName: vi.fn(),
  searchCustomers: vi.fn(),
}))
vi.mock('./ai.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ai.js')>()),
  askAi,
}))

/**
 * The customer master is stubbed rather than seeded. What is under test is
 * which of the candidates the matcher will ACCEPT as the same company; a real
 * table would only put SQL between the question and the answer, and the SQL is
 * tested where it lives.
 */
vi.mock('./customers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./customers.js')>()),
  findCustomerByName,
  searchCustomers,
}))

beforeEach(() => {
  askAi.mockReset()
  // Nothing on file unless a test says so.
  findCustomerByName.mockReset().mockReturnValue(null)
  searchCustomers.mockReset().mockReturnValue([])
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

const file = (over: Partial<CustomerRecord> = {}): CustomerRecord => ({
  id: 'c1',
  name: '',
  address: '',
  attention: '',
  gstin: '',
  state: '',
  contact: '',
  email: '',
  quoteCount: 1,
  lastUsedAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

/** Stub the model's answer, so a test can talk about the name it came back with. */
const reads = (over: Partial<ExtractedCustomer>): void => {
  askAi.mockResolvedValue({ ok: true, data: read(over) })
}

const THREAD = 'Please quote 10 x MK540.'

describe('resolveCustomer precedence', () => {
  it('lets the file win for name, address, GSTIN and state', () => {
    const { customer, customerFrom } = resolveCustomer(
      read({
        name: 'Datamatics Global Services Ltd',
        address: 'Andheri East, Mumbai',
        gstin: '27AABCU9603R1ZM',
        state: 'Maharashtra',
      }),
      file({
        name: 'Datamatics Global Services Limited',
        address: 'Knowledge Park, Andheri East, Mumbai 400093',
        gstin: '27AAACD1234E1Z5',
        state: 'Maharashtra',
      }),
    )

    expect(customer.name).toBe('Datamatics Global Services Limited')
    expect(customer.address).toBe('Knowledge Park, Andheri East, Mumbai 400093')
    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customer.state).toBe('Maharashtra')
    expect(customerFrom).toBe('on-file')
  })

  it('lets the thread win for attention, inverting the rule for the other fields', () => {
    // The stored name is whoever the last document was addressed to and may be
    // months stale; the thread is whoever is asking now.
    const { customer, customerFrom } = resolveCustomer(
      read({ name: 'Datamatics', attention: 'Ms. Priya Nair' }),
      file({ name: 'Datamatics', attention: 'Mr. Mahesh Jathar' }),
    )

    expect(customer.attention).toBe('Ms. Priya Nair')
    expect(customer.name).toBe('Datamatics')
    expect(customerFrom).toBe('both')
  })

  it('falls back to the stored attention when the thread names nobody', () => {
    const { customer } = resolveCustomer(
      read({ name: 'Datamatics', attention: '' }),
      file({ name: 'Datamatics', attention: 'Mr. Mahesh Jathar' }),
    )
    expect(customer.attention).toBe('Mr. Mahesh Jathar')
  })

  it('never lets a blank overwrite a populated value, in either direction', () => {
    // An absence is not a statement that the field is empty. Blank on file must
    // not erase the thread's address; blank in the thread must not erase the
    // file's GSTIN — and a whitespace-only value is blank.
    const { customer } = resolveCustomer(
      read({ name: 'Zensar', address: 'Kharadi, Pune', attention: '   ', gstin: '' }),
      file({ name: 'Zensar', address: '', attention: 'Mr. R Gupta', gstin: '27AAACD1234E1Z5' }),
    )

    expect(customer.address).toBe('Kharadi, Pune')
    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customer.attention).toBe('Mr. R Gupta')
  })

  it('takes the thread when there is nothing on file', () => {
    const { customer, customerFrom } = resolveCustomer(
      read({ name: 'Zensar', address: 'Kharadi, Pune', state: 'Maharashtra' }),
      null,
    )
    expect(customer.name).toBe('Zensar')
    expect(customerFrom).toBe('thread')
  })
})

describe('resolveCustomer guards a fresh read', () => {
  it('drops a state that is not an Indian state and says so', () => {
    // "Bangalore" is a city. It reaches taxModeForState if it is let through,
    // and the tax treatment is decided by the state.
    const { customer, customerMissing, customerNote } = resolveCustomer(
      read({ name: 'Zensar', state: 'Bangalore' }),
      null,
    )

    expect(customer.state).toBe('')
    expect(customerMissing).toContain('Ship-to state')
    expect(customerNote).toMatch(/ship-to state/i)
  })

  it('accepts a state in any case and returns the list spelling', () => {
    const { customer, customerMissing, customerNote } = resolveCustomer(
      read({ name: 'Zensar', state: 'karnataka' }),
      null,
    )
    expect(customer.state).toBe('Karnataka')
    expect(customerMissing).not.toContain('Ship-to state')
    expect(customerNote).toBeUndefined()
  })

  it('drops a malformed GSTIN rather than putting half a number on a document', () => {
    const { customer, customerMissing, customerNote } = resolveCustomer(
      read({ name: 'Zensar', gstin: '27AABCU9603R' }),
      null,
    )

    expect(customer.gstin).toBe('')
    expect(customerMissing).toContain('GSTIN')
    expect(customerNote).toMatch(/GSTIN/)
  })

  it('normalises case and spacing on a GSTIN that is otherwise well formed', () => {
    const { customer } = resolveCustomer(read({ name: 'Zensar', gstin: ' 27aabcu9603r1zm ' }), null)
    expect(customer.gstin).toBe('27AABCU9603R1ZM')
  })

  it('falls through to the file when a dropped value has a stored one behind it', () => {
    // A dropped value is not an error: the read still worked, and the record
    // still has a GSTIN somebody confirmed by saving a quotation with it.
    const { customer, customerMissing } = resolveCustomer(
      read({ name: 'Zensar', gstin: 'NOT-A-GSTIN', state: 'Bangalore' }),
      file({ name: 'Zensar', gstin: '27AAACD1234E1Z5', state: 'Karnataka' }),
    )

    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customer.state).toBe('Karnataka')
    expect(customerMissing).not.toContain('GSTIN')
    expect(customerMissing).not.toContain('Ship-to state')
  })

  it('names every field blank in both sources, and reports a read that found nothing', () => {
    // Distinct from a read that FAILED, which the route reports as a null
    // customer — see AiReadResponseSchema.
    const resolved = resolveCustomer(read({ confidence: 'low' }), null)

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
        name: 'Solaris Trading',
        address: 'Unit 4, Powai, Mumbai\nsales@newtech.co.in',
        attention: 'Mr. R Gupta',
        gstin: '27AABCU9603R1ZM',
        state: 'Maharashtra',
        confidence: 'high',
      },
    })

    const result = await extractCustomerFromThread('Please quote 10 x MK540.')

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
    // A blank name means the customer master is never consulted, so this needs
    // no database.
    expect(result.data.onFile).toBeNull()
  })
})

describe('resolveCustomer guards what is already on file', () => {
  it('checks a stored GSTIN rather than trusting it for being old', () => {
    // On-file WINS for the GSTIN, so an unchecked stored value is the one that
    // reaches the document. Somebody saving a quotation with it months ago is
    // not the same as anybody having looked at it.
    const { customer, customerMissing, customerNote } = resolveCustomer(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', gstin: '27AABCU9603R' }),
    )

    expect(customer.gstin).toBe('')
    expect(customerMissing).toContain('GSTIN')
    // ...and it says whose GSTIN went missing. Dropping a stored value in
    // silence is the same bug as dropping a read one in silence.
    expect(customerNote).toMatch(/GSTIN/)
    expect(customerNote).toMatch(/customer list/i)
  })

  it('drops a stored state that is not an Indian state and says so', () => {
    // The ship-to state decides the tax split, whichever side it arrived from.
    const { customer, customerMissing, customerNote } = resolveCustomer(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', state: 'Bangalore' }),
    )

    expect(customer.state).toBe('')
    expect(customerMissing).toContain('Ship-to state')
    expect(customerNote).toMatch(/ship-to state/i)
  })

  it('falls back to the thread when the stored GSTIN is the bad one', () => {
    const { customer, customerMissing } = resolveCustomer(
      read({ name: 'Zensar', gstin: '27AABCU9603R1ZM' }),
      file({ name: 'Zensar', gstin: 'GSTIN PENDING' }),
    )

    expect(customer.gstin).toBe('27AABCU9603R1ZM')
    expect(customerMissing).not.toContain('GSTIN')
  })

  it('normalises a well-formed stored value instead of rejecting it', () => {
    // The guards normalise case and spacing, so running them over the stored
    // side costs a badly typed record nothing and says nothing about it.
    const { customer, customerNote } = resolveCustomer(
      read({ name: 'Zensar' }),
      file({ name: 'Zensar', gstin: ' 27aabcu9603r1zm ', state: 'karnataka' }),
    )

    expect(customer.gstin).toBe('27AABCU9603R1ZM')
    expect(customer.state).toBe('Karnataka')
    expect(customerNote).toBeUndefined()
  })
})

describe('resolveCustomer says what it overruled', () => {
  it('names the thread values the customer list beat', () => {
    // A customer who has moved office: the new address is in the thread, last
    // year's is on file, and the file wins. Nothing reviews this on screen any
    // more, so the disagreement has to travel with the draft.
    const { customer, customerConflicts, customerNote } = resolveCustomer(
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
    expect(customerConflicts).toEqual(['Address', 'GSTIN'])
    expect(customerNote).toMatch(/different Address and GSTIN/)
    expect(customerNote).toMatch(/customer list/i)
  })

  it('says it the other way round for the field the thread wins', () => {
    const { customer, customerConflicts, customerNote } = resolveCustomer(
      read({ name: 'Zensar', attention: 'Ms. Priya Nair' }),
      file({ name: 'Zensar', attention: 'Mr. R Gupta' }),
    )

    expect(customer.attention).toBe('Ms. Priya Nair')
    expect(customerConflicts).toEqual(['Kind attention'])
    expect(customerNote).toMatch(/^Your customer list gives a different Kind attention/)
  })

  it('stays quiet when the two sources differ only in typing', () => {
    // A note that fires on capitals and double spaces is noise, and noise is
    // what teaches people to stop reading the notes.
    const { customerConflicts, customerNote } = resolveCustomer(
      read({ name: 'zensar   technologies', address: 'Kharadi,  Pune' }),
      file({ name: 'Zensar Technologies', address: 'Kharadi, Pune' }),
    )

    expect(customerConflicts).toEqual([])
    expect(customerNote).toBeUndefined()
  })

  it('does not call a blank on either side a disagreement', () => {
    const { customerConflicts } = resolveCustomer(
      read({ name: 'Zensar', address: 'Kharadi, Pune' }),
      file({ name: 'Zensar', address: '', attention: 'Mr. R Gupta' }),
    )

    expect(customerConflicts).toEqual([])
  })
})

describe('resolveCustomer repairs a stored address that lost its line breaks', () => {
  /**
   * The real record. Two lines were saved into one at some point in the past —
   * "Sec 44Gurugram", no separator at all — and on-file precedence then printed
   * it that way on every quotation for that customer, each save handing the
   * broken value straight back.
   */
  const RUN_TOGETHER = 'Plot 66, Sec 44Gurugram, Haryana - 122001'
  const WITH_BREAK = 'Plot 66, Sec 44\nGurugram, Haryana - 122001'

  it('takes the fresh read when the stored copy is the same address flattened', () => {
    const { customer } = resolveCustomer(
      read({ name: 'Zensar', address: WITH_BREAK }),
      file({ name: 'Zensar', address: RUN_TOGETHER }),
    )

    expect(customer.address).toBe(WITH_BREAK)
  })

  it('does not call the repair a disagreement between the thread and the file', () => {
    // Same address, better structure. Marking Address as a conflict would send
    // the desk off to compare two addresses that match, which is the noise the
    // conflict channel exists to avoid.
    const { customerConflicts, customerNote } = resolveCustomer(
      read({ name: 'Zensar', address: WITH_BREAK }),
      file({ name: 'Zensar', address: RUN_TOGETHER }),
    )

    expect(customerConflicts).toEqual([])
    expect(customerNote).not.toMatch(/different/i)
    // ...but it is not silent either. The record on the customer list is still
    // broken and nobody has that list open while a quotation is being made.
    expect(customerNote).toMatch(/line breaks/i)
    expect(customerNote).toMatch(/customer list/i)
  })

  it('leaves two genuinely different addresses to the ordinary precedence', () => {
    // They share most of their text and one has more lines, which is exactly
    // the shape the repair looks for. They are still different addresses, so
    // the file wins and the desk is told the thread disagreed.
    const { customer, customerConflicts } = resolveCustomer(
      read({ name: 'Zensar', address: 'Plot 66, Sec 44\nGurugram, Haryana - 122018' }),
      file({ name: 'Zensar', address: RUN_TOGETHER }),
    )

    expect(customer.address).toBe(RUN_TOGETHER)
    expect(customerConflicts).toEqual(['Address'])
  })

  it('never lets a stored address that has its breaks lose to a flattened read', () => {
    // The mirror image of the repair, and the direction that would DESTROY
    // structure rather than restore it. Sameness alone must not be enough.
    const { customer, customerNote } = resolveCustomer(
      read({ name: 'Zensar', address: RUN_TOGETHER }),
      file({ name: 'Zensar', address: WITH_BREAK }),
    )

    expect(customer.address).toBe(WITH_BREAK)
    expect(customerNote).not.toMatch(/line breaks/i)
  })

  it('counts printed lines, so padding round the same shape is not an improvement', () => {
    // Blank lines are spacing, not structure. Two lines either side, so the
    // stored copy keeps its precedence.
    const { customer } = resolveCustomer(
      read({ name: 'Zensar', address: '\n\nPlot 66, Sec 44\n\n\nGurugram, Haryana - 122001\n' }),
      file({ name: 'Zensar', address: WITH_BREAK }),
    )

    expect(customer.address).toBe(WITH_BREAK)
  })

  it('leaves the other fields on their usual precedence while it repairs', () => {
    // The repair is one field wide. A stored GSTIN is still the confirmed one.
    const { customer, customerConflicts, customerFrom } = resolveCustomer(
      read({ name: 'Zensar', address: WITH_BREAK, gstin: '27AABCU9603R1ZM' }),
      file({ name: 'Zensar', address: RUN_TOGETHER, gstin: '27AAACD1234E1Z5' }),
    )

    expect(customer.address).toBe(WITH_BREAK)
    expect(customer.gstin).toBe('27AAACD1234E1Z5')
    expect(customerConflicts).toEqual(['GSTIN'])
    expect(customerFrom).toBe('both')
  })
})

describe('matching a thread name against the customer master', () => {
  it('takes an exact name straight from the customer master', async () => {
    // The exact arm was never the risky one and is not gated on likeness.
    const record = file({ id: 'exact', name: 'Zensar Technologies' })
    findCustomerByName.mockReturnValue(record)
    reads({ name: 'Zensar Technologies' })

    const result = await extractCustomerFromThread(THREAD)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.onFile).toBe(record)
    expect(searchCustomers).not.toHaveBeenCalled()
  })

  it('accepts a stored name that is the same company written longer', async () => {
    const record = file({ name: 'Datamatics Global Services Limited', gstin: '27AAACD1234E1Z5' })
    searchCustomers.mockReturnValue([record])
    reads({ name: 'Datamatics Global Services' })

    const result = await extractCustomerFromThread(THREAD)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.onFile?.name).toBe('Datamatics Global Services Limited')
  })

  it('refuses a candidate that merely shares a word with the thread name', async () => {
    // searchCustomers is a substring match with no floor: "Kirloskar" fetches
    // every Kirloskar on the list, and they are separate legal entities with
    // separate GSTINs. Taking the first put one company's tax number on the
    // other's document.
    searchCustomers.mockReturnValue([
      file({
        name: 'Kirloskar Oil Engines Limited',
        address: 'Khadki, Pune 411003',
        gstin: '27AAACK1234E1Z5',
      }),
    ])
    reads({ name: 'Kirloskar', address: 'Powai, Mumbai', gstin: '27AABCU9603R1ZM' })

    const result = await extractCustomerFromThread(THREAD)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.onFile).toBeNull()

    // Refusing is not an error: the thread's own values stand.
    const { customer } = resolveCustomer(result.data.extracted, result.data.onFile)
    expect(customer.address).toBe('Powai, Mumbai')
    expect(customer.gstin).toBe('27AABCU9603R1ZM')
  })

  it('scores every candidate instead of taking the typeahead first', async () => {
    // The typeahead ranks by prefix then recency, so the Kirloskar quoted most
    // recently leads whether or not it is the one being quoted now.
    const wrong = file({ id: 'oil', name: 'Kirloskar Oil Engines Limited' })
    const right = file({ id: 'brothers', name: 'Kirloskar Brothers Limited' })
    searchCustomers.mockReturnValue([wrong, right])
    reads({ name: 'Kirloskar Brothers' })

    const result = await extractCustomerFromThread(THREAD)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.onFile?.id).toBe('brothers')
    // Scoring one candidate is not scoring. The fetch has to be wide enough to
    // leave something to choose between.
    expect(searchCustomers.mock.calls[0][1]).toBeGreaterThan(1)
  })
})
