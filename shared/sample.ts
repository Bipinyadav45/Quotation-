/**
 * §11's sample thread — the primary test fixture, and the "Load sample" button
 * on screen 1. Reproduced verbatim, irregular spacing included: the double
 * spaces and the missing space in "Rs. 2750+" are exactly the kind of thing the
 * parser has to survive, so normalising them here would hide a real bug.
 */
export const SAMPLE_THREAD = `On Fri, Jul 10, 2026 at 5:52 PM rakhi gupte <rakhi.gupte@newtech.in> wrote:
Black i USB-C to USB-A 1.5 mtr, Qty- 02 -  Rs. 550 + gst each
Black i USB-C to USB-C 1.5 mtr,  Qty- 02  - Rs. 850 + gst each
Lightning to USB A 1.5 mtr, Qty- 02 - Rs. 1,250 + gst each
Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP, Qty - 01 - Rs. 2750+ gst each
Logitech Wireless Keyboard and Mouse Set #MK540, Qty- 01 - Rs. 3,450 + gst each

On Fri, Jul 10, 2026 at 1:24 PM <Subhransu.Kar@morganstanley.com> wrote:
Black i USB-C to USB-A 1.5 mtr, Qty- 02
Black i USB-C to USB-C 1 mtr,  Qty- 02
Black i Lightning to USB A 1.5 mtr, Qty- 02
Black i USB Type C Docking Station with USB A and USB C ports - BI-TCHUGP, Qty - 01
Logitech Wireless Keyboard and Mouse Set #MK540, Qty- 01`

/** §11 — the customer this thread belongs to. Karnataka ship-to, so IGST. */
export const SAMPLE_CUSTOMER = {
  name: 'Morgan Stanley Advantage Services Pvt Ltd',
  address: 'Campus 8B, Sarjapur, Marathahalli\nOuter Ring Road, Bengaluru - 560103',
  attention: 'Mr. Subhransu Kar',
  state: 'Karnataka',
} as const
