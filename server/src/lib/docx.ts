import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import { readFileSync } from 'node:fs'
import type { Quote } from '@shared/schema.js'
import { computeTotals, formatPaise, pad2 } from '@shared/money.js'
import { formatDateLong, fromISODate } from '@shared/fy.js'
import { config } from '../config.js'

/**
 * Template injection (§8).
 *
 * Every value handed to docxtemplater is already a STRING. §8 is explicit that
 * "docxtemplater must never see a raw float", and the reason is not tidiness:
 * a number reaching the template renders with JavaScript's default formatting,
 * so 1100 prints as "1100" instead of "1,100.00" and a rate of 0.1 + 0.2 prints
 * as "0.30000000000000004" in a customer-facing quotation.
 */

export interface RenderModel {
  ref: string
  dateLong: string
  customerName: string
  customerAddress: string
  attention: string
  contact: string
  email: string
  items: Array<{
    sr: string
    desc: string
    rate: string
    qty: string
    amount: string
  }>
  subTotal: string
  taxRows: Array<{ taxLabel: string; taxAmount: string }>
  grandTotal: string
  payment: string
  delivery: string
  pricesTerm: string
  /** The letterhead's fourth term is Warranty, not Validity. */
  warranty: string
  signatory: string
}

export function buildRenderModel(quote: Quote): RenderModel {
  // Recomputed here rather than read from the stored totals, so the document
  // can never disagree with its own line items.
  const totals = computeTotals(quote.items, quote.tax.mode, quote.tax.rate)

  return {
    ref: quote.revision > 0 ? `${quote.ref} (Rev ${quote.revision})` : quote.ref,
    dateLong: formatDateLong(fromISODate(quote.date)),
    customerName: quote.customer.name,
    customerAddress: quote.customer.address,
    attention: quote.customer.attention,
    contact: quote.contact,
    email: quote.email,
    items: quote.items.map((item, index) => ({
      // §7 — serial numbers and quantities zero-padded to 2 digits.
      sr: pad2(index + 1),
      desc: item.desc,
      rate: formatPaise(item.rate),
      qty: pad2(item.qty),
      amount: formatPaise(item.qty * item.rate),
    })),
    subTotal: formatPaise(totals.sub),
    taxRows: totals.taxRows.map((row) => ({
      taxLabel: row.label,
      taxAmount: formatPaise(row.paise),
    })),
    grandTotal: formatPaise(totals.total),
    payment: quote.terms.payment,
    delivery: quote.terms.delivery,
    pricesTerm: quote.terms.prices,
    warranty: quote.terms.validity,
    signatory: quote.signatory,
  }
}

export function renderDocx(quote: Quote): Buffer {
  const zip = new PizZip(readFileSync(config.templatePath))

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    // Lets "\n" in the customer address become a real line break rather than a
    // literal backslash-n in the document.
    linebreaks: true,
    // A missing tag should be blank, not the string "undefined" on a quotation.
    nullGetter: () => '',
  })

  doc.render(buildRenderModel(quote) as unknown as Record<string, unknown>)

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** §8 — `Quotation-<CustomerFirstWord>-<date>.docx` */
export function documentFilename(quote: Quote, extension: 'docx' | 'pdf'): string {
  const firstWord = quote.customer.name.trim().split(/\s+/)[0] ?? 'Customer'
  const safe = firstWord.replace(/[^A-Za-z0-9]/g, '')
  const rev = quote.revision > 0 ? `-Rev${quote.revision}` : ''
  return `Quotation-${safe || 'Customer'}-${quote.date}${rev}.${extension}`
}
