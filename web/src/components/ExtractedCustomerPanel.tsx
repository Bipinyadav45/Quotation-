import { useState } from 'react'
import type { CustomerRecord, ExtractedCustomer } from '@shared/schema'
import Callout from './Callout'

export type CustomerFields = {
  name: string
  address: string
  attention: string
  gstin: string
  state: string
}

interface Props {
  extracted: ExtractedCustomer
  onFile: CustomerRecord | null
  onAccept: (fields: Partial<CustomerFields>) => void
  onDismiss: () => void
}

const FIELDS: Array<{ key: keyof CustomerFields; label: string }> = [
  { key: 'name', label: 'Customer' },
  { key: 'address', label: 'Address' },
  { key: 'attention', label: 'Kind attention' },
  { key: 'state', label: 'Ship-to state' },
  { key: 'gstin', label: 'GSTIN' },
]

/**
 * What Claude read out of the thread, offered field by field.
 *
 * Per-field, because a wrong address must not force you to discard a correct
 * GSTIN. Nothing here is applied until it is clicked — the rule the whole
 * application runs on is that AI suggests and a human accepts.
 *
 * Where a value is already on file, the stored one is shown alongside and
 * offered first: it was confirmed by someone saving a quotation with it,
 * whereas a GSTIN read out of an email signature is a suggestion, not a
 * verification.
 */
export default function ExtractedCustomerPanel({
  extracted,
  onFile,
  onAccept,
  onDismiss,
}: Props) {
  const [taken, setTaken] = useState<Set<string>>(new Set())

  const accept = (key: keyof CustomerFields, value: string) => {
    onAccept({ [key]: value } as Partial<CustomerFields>)
    setTaken((prev) => new Set(prev).add(`${key}:${value}`))
  }

  const acceptAllOnFile = () => {
    if (!onFile) return
    onAccept({
      name: onFile.name,
      address: onFile.address,
      attention: onFile.attention,
      gstin: onFile.gstin,
      state: onFile.state,
    })
    setTaken(new Set(FIELDS.map((f) => `${f.key}:onfile`)))
  }

  const rows = FIELDS.map((f) => ({
    ...f,
    read: extracted[f.key] ?? '',
    stored: onFile ? ((onFile[f.key] as string) ?? '') : '',
  })).filter((r) => r.read !== '' || r.stored !== '')

  return (
    <div className="panel mb-3 p-3 no-print">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h3 className="label">
          Read from the thread by Claude
          <span className="ml-2 font-normal normal-case tracking-normal text-ink-faint">
            confidence: {extracted.confidence} · nothing is filled in until you click it
          </span>
        </h3>
        <button type="button" className="btn px-2 py-0.5 text-[12px]" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      {extracted.confidence === 'low' && (
        <Callout tone="drift" label="Unsure" className="mb-2">
          Claude was not confident which party in this thread is the customer. Check every field
          before accepting it.
        </Callout>
      )}

      {onFile && (
        <Callout className="mb-2" label="On file">
          You have quoted <span className="font-medium">{onFile.name}</span>{' '}
          {onFile.quoteCount} time{onFile.quoteCount === 1 ? '' : 's'} before. Your stored details
          were confirmed by a saved quotation; a value read out of an email signature was not.
          <button
            type="button"
            className="btn ml-2 px-2 py-0.5 text-[12px]"
            onClick={acceptAllOnFile}
          >
            Use the details on file
          </button>
        </Callout>
      )}

      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-muted">
          Claude found no customer details in this thread. Nothing was invented to fill the gap.
        </p>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-rule first:border-t-0 align-top">
                <td className="label w-32 py-1.5">{row.label}</td>

                <td className="py-1.5 pr-2">
                  {row.read === '' ? (
                    <span className="text-ink-faint">not in the thread</span>
                  ) : (
                    <span className="whitespace-pre-line">{row.read}</span>
                  )}
                </td>

                <td className="w-24 py-1.5 text-right">
                  {row.read !== '' && (
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-[11px]"
                      disabled={taken.has(`${row.key}:${row.read}`)}
                      onClick={() => accept(row.key, row.read)}
                    >
                      {taken.has(`${row.key}:${row.read}`) ? 'accepted' : 'Accept'}
                    </button>
                  )}
                </td>

                <td className="w-56 border-l border-rule py-1.5 pl-2">
                  {row.stored === '' ? (
                    <span className="text-ink-faint">—</span>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <span className="whitespace-pre-line text-ink-muted">{row.stored}</span>
                      {row.stored !== row.read && (
                        <button
                          type="button"
                          className="btn shrink-0 px-2 py-0.5 text-[11px]"
                          onClick={() => accept(row.key, row.stored)}
                        >
                          Use
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Left column: read from the thread. Right column: what you already have on file.
        </p>
      )}
    </div>
  )
}
