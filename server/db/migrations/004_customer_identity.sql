-- 004_customer_identity — a customer is a LEDGER, not a name.
--
-- The desk's Tally list has 225 sundry debtors and the names in it collide on
-- purpose: "Datamatics Global Services" is sixteen ledgers across six GSTINs,
-- "Morgan Stanley" is seventeen across ten, and three Azentio sites share one
-- registration. Thirty-nine GSTINs are held by more than one ledger.
--
-- 002 declared identity to be the name — UNIQUE (lower(name)) — and everything
-- above it followed: findCustomerByName, matchOnFile taking the single best
-- fuzzy match, and a draft filled from it with nothing in between. Against this
-- list that is a way to put one group company's GSTIN and state on a document
-- addressed to another, and the state also decides IGST vs CGST+SGST. The name
-- stops being identity here.
--
-- What replaces it is the row's own id, which is why quotes gain customer_id:
-- until now the only record of who a quotation was for was the name text copied
-- onto it, and that text cannot distinguish Azentio Malad from Azentio Vashi.

DROP INDEX idx_customers_name;

-- The Tally ledger name, normalised. Unique because Tally ledger names are:
-- it is what makes re-importing a refreshed export an update rather than a
-- second copy of the list. Rows the master taught itself from a saved
-- quotation get one too, so a name typed twice is still one customer.
ALTER TABLE customers ADD COLUMN ledger_key TEXT NOT NULL DEFAULT '';

-- 'tally'  — imported from the sundry debtors export; the accounting truth.
-- 'quote'  — learned from a saved quotation, for a company not on that list.
ALTER TABLE customers ADD COLUMN source TEXT NOT NULL DEFAULT 'quote';

-- Off the export, and kept because they are the reason a row has no state:
-- five of the 225 are outside India, where "ship-to state" has no meaning and
-- must stay blank rather than be guessed into one.
ALTER TABLE customers ADD COLUMN country  TEXT NOT NULL DEFAULT 'India';
ALTER TABLE customers ADD COLUMN reg_type TEXT NOT NULL DEFAULT '';

-- Empty for a row that has never been in an export. Set on every import so a
-- ledger deleted from Tally can be told from one that simply has no quotations.
ALTER TABLE customers ADD COLUMN imported_at TEXT NOT NULL DEFAULT '';

-- Backfill before the index goes on: rows written under 002 are all
-- self-learned, and their name is the only key they ever had.
UPDATE customers SET ledger_key = lower(trim(name)) WHERE ledger_key = '';

CREATE UNIQUE INDEX idx_customers_ledger ON customers (ledger_key);

-- The typeahead searches the address now — it is the only thing that separates
-- three ledgers sharing a name AND a GSTIN — and the chooser searches GSTIN.
CREATE INDEX idx_customers_gstin ON customers (gstin) WHERE gstin != '';

-- WHICH ledger this quotation was addressed to.
--
-- Nullable, and stays null for the quotations already saved: they were written
-- when a name was thought to be enough, and inventing a ledger for them now
-- would be a guess recorded as a fact. It is also null for a company quoted
-- deliberately off the list. customer_name remains the text that PRINTED, so
-- every past quotation still renders exactly as it was sent.
ALTER TABLE quotes ADD COLUMN customer_id TEXT REFERENCES customers (id);

CREATE INDEX idx_quotes_customer ON quotes (customer_id) WHERE customer_id IS NOT NULL;
