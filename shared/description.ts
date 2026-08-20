/**
 * A line item's description is stored as one string but printed as two parts:
 * the product name, bold and underlined, and the specification beneath it,
 * plain.
 *
 * That split has to happen somewhere, and it has to happen in exactly one
 * place. The Word document needs it because docxtemplater substitutes text and
 * not formatting — a single {desc} tag could only ever render the whole thing
 * in one weight, so the template has separate {descName} and {descSpec} tags.
 * The on-screen preview needs the same split to show the same thing. Two copies
 * of this three-line function is two copies that can disagree, and a preview
 * that disagrees with the download is the bug the preview exists to prevent.
 *
 * The first line is the name. That is how the desk writes them, and it is how
 * §5's parser assembles them — specification lines are appended beneath the
 * product line they were found under.
 */
export interface SplitDescription {
  descName: string
  descSpec: string
}

export function splitDescription(desc: string): SplitDescription {
  const [first = '', ...rest] = desc.split('\n')
  return { descName: first.trim(), descSpec: rest.join('\n').trim() }
}
