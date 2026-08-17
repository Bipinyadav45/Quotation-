/** @type {import('tailwindcss').Config} */
export default {
  content: ['./web/index.html', './web/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // §9 — cream paper ground, ink-dark text.
        paper: { DEFAULT: '#F7F4EC', raised: '#FDFBF6', sunk: '#EFEADD' },
        ink: { DEFAULT: '#1A1815', muted: '#57534E', faint: '#8B8378' },
        rule: { DEFAULT: '#DAD3C3', strong: '#B6AC96' },

        // §9 — a single deep-blue accent for navigation and primaries.
        accent: { DEFAULT: '#1E3A5F', hover: '#152C4A', faint: '#E6EDF5' },

        // §9 — amber is RESERVED EXCLUSIVELY for drift flags. Never decorative.
        // If you are reaching for `drift-*` and you are not rendering a Flag,
        // you are about to break the one rule that makes this screen scannable.
        drift: { DEFAULT: '#9A5B0B', bg: '#FBF1DF', rule: '#DEBC85' },

        // A system failure — a download that would not build, a server that did
        // not answer. Deliberately NOT amber: a broken button and "the customer
        // asked for something else" are different problems, and if they shared a
        // colour, amber would stop meaning the second one.
        alert: { DEFAULT: '#8C2F1E', bg: '#F9EDEA', rule: '#D9A79B' },
      },
      fontFamily: {
        // §9 — no SaaS-landing-page aesthetics. Institutional, legible, dense.
        sans: ['Segoe UI', 'system-ui', '-apple-system', 'Helvetica Neue', 'sans-serif'],
        // §9 — monospace for reference numbers, quantities, money and field labels.
        mono: ['Consolas', 'SFMono-Regular', 'Menlo', 'DejaVu Sans Mono', 'monospace'],
        // §9 — serif ONLY inside the document preview, so it reads as paper.
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
      borderRadius: {
        // §9 — no rounded pills.
        DEFAULT: '2px',
        sm: '1px',
        md: '2px',
        lg: '3px',
      },
    },
  },
  plugins: [],
}
