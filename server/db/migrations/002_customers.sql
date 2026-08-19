-- 002_customers — the customer master, and two indexes for price memory.
--
-- There is no data-entry screen for this table and there never will be: it
-- fills itself from the quotations that get saved. The second quotation to a
-- customer offers everything the first one typed.

CREATE TABLE customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  address      TEXT NOT NULL DEFAULT '',
  attention    TEXT NOT NULL DEFAULT '',
  gstin        TEXT NOT NULL DEFAULT '',
  state        TEXT NOT NULL DEFAULT '',
  -- Our contact and email as used for this customer — the salesperson who owns
  -- the account usually stays the same, so they are worth remembering too.
  contact      TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  quote_count  INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

-- One row per customer regardless of how it was capitalised on the day.
CREATE UNIQUE INDEX idx_customers_name ON customers (lower(name));
CREATE INDEX idx_customers_recent ON customers (last_used_at DESC);

-- Price memory reads quote_items by part code and by quote; both are lookups
-- across the whole history rather than within one quotation.
CREATE INDEX idx_quote_items_part_code ON quote_items (part_code) WHERE part_code != '';
CREATE INDEX idx_quote_items_desc ON quote_items (description);
