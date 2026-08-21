-- 003_warranty — the warranty, promoted out of the description into term 5.
--
-- It used to be written inside the product description and printed there. That
-- put it on the page once per line that carried it, and left the desk unable to
-- edit it the way the other four terms are edited. It is a term now, so it is
-- stored beside them.
--
-- Blank is a normal, expected value here, not a missing one: it means no
-- warranty was stated, and a quotation with no warranty prints four terms
-- rather than a fifth with nothing after it. That is what makes the DEFAULT
-- safe for the rows already in this table — every quotation saved before today
-- stated no warranty as a term, so every one of them reads back exactly as it
-- rendered yesterday.

ALTER TABLE quotes ADD COLUMN term_warranty TEXT NOT NULL DEFAULT '';  -- '' = none stated
