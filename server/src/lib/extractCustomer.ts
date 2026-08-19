import { z } from 'zod'
import { config } from '../config.js'
import { askAi, type AiResult } from './ai.js'
import { findCustomerByName, searchCustomers, type CustomerRecord } from './customers.js'

/**
 * Read the customer's details out of an RFQ thread.
 *
 * The hard part is not extraction, it is knowing whose details to take: every
 * one of these threads carries Newtech's own signature block, usually several
 * times, and it is longer and tidier than the customer's. So the internal
 * domain is passed in and the model is told explicitly to skip it.
 *
 * Nothing here writes to a quotation. The result is a suggestion, shown with
 * its provenance and accepted field by field.
 */

/**
 * Deliberately no phone or email.
 *
 * The "Contact Number" and "Email" on the quotation are OURS — the
 * salesperson's, in the From block. The customer's own are nowhere on the
 * document, so extracting them would only create a field with two meanings and
 * an obvious way to put the customer's number on our letterhead.
 */
export const ExtractedCustomerSchema = z.object({
  name: z.string(),
  address: z.string(),
  attention: z.string(),
  gstin: z.string(),
  state: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type ExtractedCustomer = z.infer<typeof ExtractedCustomerSchema>

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'The customer company name. "" if not stated.' },
    address: {
      type: 'string',
      description: 'The customer postal address, newline separated. "" if not stated.',
    },
    attention: {
      type: 'string',
      description: 'The person to address it to, e.g. "Mr. Mahesh Jathar". "" if not stated.',
    },
    gstin: { type: 'string', description: 'Their 15-character GSTIN. "" if not stated.' },
    state: {
      type: 'string',
      description: 'Their Indian state, spelled in full, e.g. "Karnataka". "" if not stated.',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How clearly the thread identified the customer.',
    },
  },
  required: ['name', 'address', 'attention', 'gstin', 'state', 'confidence'],
  additionalProperties: false,
} as const

export interface ExtractionResult {
  extracted: ExtractedCustomer
  /**
   * The matching row from the customer master, when there is one.
   *
   * A stored record beats a fresh read of an email footer every time: it was
   * confirmed by someone saving a quotation with it, and a GSTIN read out of a
   * signature is a suggestion, not a verification.
   */
  onFile: CustomerRecord | null
}

export async function extractCustomerFromThread(
  thread: string,
): Promise<AiResult<ExtractionResult>> {
  const system = `You read B2B email threads at an Indian IT hardware reseller and pull out the CUSTOMER's details.

The reseller is Newtech Computer Services Pvt. Ltd. Their email addresses end in
"@${config.internalEmailDomain}". Their signature block appears in almost every message, often
several times, and their address is 6th Floor, Solaris-II, Saki Vihar Road, Powai, Mumbai.

NEVER return Newtech's details. You want the other party — whoever is asking for a quotation.

Rules:
- Copy values exactly as written. Do not correct, expand or reformat them.
- A field you cannot find is "", never a guess. An invented address on a
  quotation is worse than a blank one someone types.
- "attention" is the individual the quotation should be addressed to, with any
  honorific, as the thread writes it.
- "state" is the Indian state, spelled in full. Infer it from the city only
  when the city is unambiguous (Bengaluru -> Karnataka, Powai -> Maharashtra).
- "gstin" is 15 characters. If you cannot see one, "".
- confidence: "high" when the thread clearly identifies one customer,
  "medium" when you had to infer, "low" when you are unsure who the customer is.`

  const result = await askAi({
    system,
    user: thread,
    outputSchema: OUTPUT_SCHEMA,
    validate: ExtractedCustomerSchema,
    effort: 'low',
  })

  if (!result.ok) return result

  const extracted = result.data
  const guard = rejectOwnDetails(extracted)

  // Prefer what we already hold: exact name first, then the typeahead's own
  // ranking, so "Datamatics Global Services Ltd" still finds the stored
  // "Datamatics Global Services Limited".
  const onFile =
    guard.name.trim() === ''
      ? null
      : (findCustomerByName(guard.name) ?? searchCustomers(guard.name, 1)[0] ?? null)

  return { ok: true, data: { extracted: guard, onFile } }
}

/**
 * Last line of defence. The prompt says not to return Newtech's details; this
 * makes sure a slip cannot put our own address on a quotation addressed to us.
 */
function rejectOwnDetails(c: ExtractedCustomer): ExtractedCustomer {
  const looksInternal = /newtech/i.test(c.name) || c.address.toLowerCase().includes('saki vihar')

  if (!looksInternal) return c
  return { name: '', address: '', attention: '', gstin: '', state: '', confidence: 'low' }
}
