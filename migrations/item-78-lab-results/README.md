# Item 78 — Blood test results

Manual entry of blood test results (lipids, HbA1c, ferritin, vitamin D, thyroid,
liver, kidney, full blood count, hormones, inflammation) with reference ranges and
trend lines.

`server.ts` creates `lab_results` from its schema map on boot, so **this migration is
an optional mirror** for a database the app has not started against yet. It is
idempotent: running it on a live database is a no-op.

## The table

```
lab_results(id, user_id, taken_on VARCHAR(10), analyte VARCHAR(40), value REAL,
            unit VARCHAR(16), ref_low REAL, ref_high REAL, lab VARCHAR(60),
            notes TEXT, created_at)
UNIQUE(user_id, taken_on, analyte)
```

`taken_on` is a bare `YYYY-MM-DD` in the user's own zone, held as VARCHAR (not TEXT,
which MySQL cannot put a UNIQUE key on — same reason as `day_tags`). A blood draw
belongs to a day, not an instant, and no zone conversion is ever applied to it.

The UNIQUE key means re-entering an analyte for a day you already have **replaces**
that value rather than adding a second one: the common case is a typo being
corrected, not two draws of the same analyte on one day. Writes are
UPDATE-then-`INSERT OR IGNORE`, never `INSERT OR REPLACE` — `translateSql` turns the
latter into `DO NOTHING` on Postgres, which would silently keep the old value the
user had just come to fix.

## Reference ranges: the row wins

`ref_low`/`ref_high` are the range printed on the user's own report. They are
nullable, and when they are null `src/lib/labs.ts` falls back to a typical adult UK
range from its catalogue (sex-specific where the usual range differs: ferritin,
haemoglobin, haematocrit, ALT, GGT, creatinine, urate).

The API reports which of the two it used (`range.source`: `row` | `catalogue` |
`none`) and the card labels it "your report" or "typical range". This is deliberate:
labs differ in method and population, so a catalogue range is a rough guide and not a
fact about this user. A value with no range on either side is flagged `unknown` and
shown with no verdict — not `in_range`.

Nothing in the catalogue is interpretation. `better: 'lower' | 'higher' | 'within'`
only drives whether an arrow is drawn green or red between two of the user's own
results; it is not advice, and the app says nothing about what any value means.

## Flags and movement

* `flagOf` uses **inclusive** bounds — a value exactly on the limit is in range.
* `trends()` sorts a user's rows by `taken_on`, not insertion order, so a
  back-entered older panel does not become "latest".
* `change` is latest minus previous in the row's own unit; `movement` is `better` /
  `worse` / `flat`, and `null` for an analyte whose catalogue direction is `within`
  (where neither direction is an improvement) or one with no previous result.
* `outOfRange()` reports exceptions from the **latest panel only** — a value that was
  high two years ago and normal since is not a current exception.

## Dates

Day validation goes through `isCalendarDay` in `src/lib/dayTags.ts`, which round-trips
via `Date.UTC`. Do not substitute `Date.parse`: it accepts `2026-02-30` and silently
means 1 March, which would file a result under the wrong day.

## Widget

`labs` ("Blood tests") is **opt-in** in the dashboard layout settings, like
`medications` — it is empty for anyone who has never typed a result in.

## Not checked

MySQL/MariaDB. The column types are chosen to be portable (VARCHAR keys, REAL, TEXT
for free notes) but only SQLite and Postgres were exercised.
