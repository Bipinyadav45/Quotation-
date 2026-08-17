-- 001_init — Newtech Quotation Desk
--
-- Money is stored as INTEGER PAISE throughout. Never store rupees in a REAL
-- column: 0.1 + 0.2 !== 0.3, and a quotation that is one paisa off is a
-- quotation the customer's procurement system rejects. §7's rounding rule
-- ("compute per line, sum to subtotal, apply tax to the subtotal, round the
-- total to 2 decimals, do not round intermediate lines") is preserved exactly
-- by doing the arithmetic in integers.

CREATE TABLE quotes (
  id             TEXT PRIMARY KEY,
  ref            TEXT NOT NULL,             -- NCS/2026-27/Quotes/RG/031
  revision       INTEGER NOT NULL DEFAULT 0,-- 0 = original, 1 = "Rev 1", ...
  date           TEXT NOT NULL,             -- ISO 8601

  customer_name      TEXT NOT NULL,
  customer_address   TEXT NOT NULL DEFAULT '',
  customer_attention TEXT NOT NULL DEFAULT '',
  customer_gstin     TEXT,
  customer_state     TEXT,                  -- drives the tax mode default (§7)

  contact        TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  signatory      TEXT NOT NULL DEFAULT '',

  tax_mode       TEXT NOT NULL,             -- 'IGST' | 'CGST+SGST'
  tax_rate       INTEGER NOT NULL,          -- percent, e.g. 18

  term_payment   TEXT NOT NULL DEFAULT '',
  term_delivery  TEXT NOT NULL DEFAULT '',
  term_prices    TEXT NOT NULL DEFAULT '',
  term_validity  TEXT NOT NULL DEFAULT '',

  sub_paise      INTEGER NOT NULL DEFAULT 0,
  tax_paise      INTEGER NOT NULL DEFAULT 0,
  total_paise    INTEGER NOT NULL DEFAULT 0,

  -- §4: "Every quote stores its source thread and its reconciliation result.
  -- When a customer disputes a line six weeks later, the audit trail is in the
  -- record." Reconciliation is an audit blob, never queried by field.
  source_thread  TEXT NOT NULL DEFAULT '',
  reconciliation TEXT NOT NULL DEFAULT '[]',

  status         TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | won | lost
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_quotes_ref_revision ON quotes (ref, revision);
CREATE INDEX idx_quotes_created_at ON quotes (created_at DESC);

CREATE TABLE quote_items (
  id          TEXT PRIMARY KEY,
  quote_id    TEXT NOT NULL REFERENCES quotes (id) ON DELETE CASCADE,
  line_no     INTEGER NOT NULL,          -- 1-based; rendered zero-padded to 2 (§7)
  description TEXT NOT NULL,
  make        TEXT NOT NULL DEFAULT '',  -- §7: customers on Ariba/SAP need this
  part_code   TEXT NOT NULL DEFAULT '',
  hsn         TEXT,
  qty         INTEGER NOT NULL,
  rate_paise  INTEGER NOT NULL,          -- unit, exclusive of tax
  amount_paise INTEGER NOT NULL          -- qty * rate_paise, unrounded
);

CREATE INDEX idx_quote_items_quote ON quote_items (quote_id, line_no);

-- Correction 4 — §6 requires brand flags but §5 never defines brand extraction.
-- "Black i" is two words with a lowercase second token, so no capitalisation
-- heuristic finds it. This table is the lookup, and it doubles as the source of
-- the manufacturer address §11 requires for Ariba.
CREATE TABLE makes (
  name                 TEXT PRIMARY KEY COLLATE NOCASE,
  manufacturer_address TEXT NOT NULL DEFAULT ''
);

INSERT INTO makes (name, manufacturer_address) VALUES
  ('Black i',   'Bengaluru 560002'),
  ('Logitech',  ''),
  ('Dell',      ''),
  ('HP',        ''),
  ('Lenovo',    ''),
  ('Apple',     ''),
  ('Samsung',   ''),
  ('Seagate',   ''),
  ('Western Digital', ''),
  ('Kingston',  ''),
  ('TP-Link',   ''),
  ('D-Link',    ''),
  ('Cisco',     ''),
  ('APC',       '');

-- §7: "Sequence is per financial year, allocated by the server on save,
-- zero-padded to 3. Never allocate on page load; a page opened and abandoned
-- must not burn a number." Allocation runs inside a transaction against this
-- table so two concurrent saves cannot take the same number.
CREATE TABLE ref_counters (
  fy       TEXT NOT NULL,   -- '2026-27'
  initials TEXT NOT NULL,   -- 'RG'
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fy, initials)
);
