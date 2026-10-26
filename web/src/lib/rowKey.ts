/**
 * A key for a row in the quotation editor, unique for the life of the page.
 *
 * This used to be crypto's randomUUID, which a browser only provides in a
 * secure context: HTTPS, or localhost. Development is localhost, so it always
 * worked there. QA and production are plain http:// on the LAN, where it is
 * undefined — so "Read the thread" failed on the first parsed line with
 * "crypto.randomUUID is not a function", every time, for every thread.
 *
 * The key never leaves the browser. It is React's row key and the handle the
 * editor looks a row's price history up by, so it has to be unique among the
 * rows on screen and nothing more. A counter is exactly that.
 * web/secure-context.test.ts keeps the original call from coming back.
 */
let last = 0

export const newRowKey = (): string => `row-${++last}`
