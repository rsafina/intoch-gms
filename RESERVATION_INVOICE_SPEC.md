# Linking reservations, invoices and payments

**Status:** scoped, not built. Decisions taken 2026-08-23 with Rere.
**Repo:** `intoch-gms`. Nothing here has been implemented.

---

## The story this exists for

Ali runs Rocker Company. He finds the restaurant on Instagram, opens the
booking form, and books lunch for 30. Because it is 30 covers he wants the food
prepped ahead so nobody waits, so he pre-orders. Prep costs the restaurant money
before anyone eats, so they ask for 50% up front and the balance later.

Today the restaurant can do all of that. What it cannot do is **remember** any
of it. The booking is in one place, the invoice is a PDF that exists in
somebody's Downloads folder, and whether the deposit ever arrived lives in a
WhatsApp thread and a person's memory.

## What breaks today, precisely

| Step | Today |
|---|---|
| Books 30 pax on the form | Works |
| Says he is from Rocker Company | Only as free text in Notes. `guests.company` exists; the public form never asks |
| Pre-orders the menu | Nothing anywhere |
| Restaurant issues an invoice | The page works, but every field is retyped and only the last 5 survive, in one browser's `localStorage` |
| 50% deposit | Printed on the sheet. Stored nowhere |
| Chase the deposit, then the balance | `reservations.follow_up_done` is one boolean. One "done", no stages |
| Money arrives | Nothing in the database records a payment |

**Nothing in the schema stores money against a booking.** `visits.spend_amount`
is what a guest spent after eating, which is a different fact.

---

## Decisions taken

| # | Decision | Chosen |
|---|---|---|
| 1 | How far the link goes | **Deposit-backed booking.** Invoices become records, and a reservation carries payment state |
| 2 | Editing an issued invoice | **Manager may edit, every change logged** |
| 3 | Where the pre-order is captured | **Staff type it in**, from WhatsApp or a call |
| 4 | Visibility | Badge on the reservation row, task in the bell, report of money outstanding |
| 5 | A payment with no invoice | **Allowed, 2026-09-05.** A payment attaches to an invoice OR a reservation, exactly one of the two |
| 6 | Building this before RLS | **Accepted, 2026-09-05.** See Risks question 1, rewritten below |

### Decision 5: payments do not require an invoice

The deposit flow deliberately issues no invoice. Auto-issuing one was dropped in
September in favour of a QR, precisely because minting numbered financial documents
from a public form dragged in numbering, rate limiting and an audit trail nobody
needed yet.

But `invoice_payments.invoice_id` was written as required, so as first drafted **a
deposit could not be recorded without inventing an invoice for it**. That is paperwork
created to satisfy a foreign key.

Decision 1 already said "a reservation carries payment state"; the data model simply did
not follow through. So:

- `invoice_id` becomes nullable, and `reservation_id` is added
- a CHECK requires **exactly one** of them to be set
- everything else is unchanged: rows not columns, free-text `method`, negative amounts
  for refunds, and no stored status

One table, one set of rules. A deposit records against the booking today; when invoices
arrive they use the same table rather than a parallel one.

Decision 2 answers the question Rere left in July when she chose not to give
invoices a database at all:

> Do not add a table without first deciding who may edit an already-issued
> invoice and whether it implies payment tracking.

Both halves are now answered. It does imply payment tracking, and managers may
edit with an audit trail.

### The constraint that shapes the whole model

> "the payment itself vary between each restaurant anyway, so we cant put exact
> writing format for this" — Rere, 2026-08-23

This rules out modelling deposits as columns. `dp_amount` and `balance` encode
one restaurant's habit as a schema, and the next client takes a flat Rp 500k
regardless of size, or full prepayment, or three instalments, or nothing.

**Payments are rows.** An invoice has a total and zero or more recorded
payments. Everything else is arithmetic. The "Down Payment 50%" line stays what
it already is — a line printed on a document — while what gets *tracked* is
money in, whatever shape it arrives in.

---

## Data model

### `invoices`

One row per issued document. `reservation_id` is nullable on purpose: a large
takeaway order gets an invoice and has no booking behind it.

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `invoice_number` | text, unique. Hand-typed today; see open question 1 |
| `reservation_id` | uuid null → `reservations(id)`. Many invoices may point at one booking |
| `guest_id` | uuid null → `guests(id)` |
| `bill_to_name`, `table_label`, `pax` | denormalised from the booking at issue time, see below |
| `payment_date`, `event_date` | date |
| `subtotal`, `service_charge`, `tax`, `total` | numeric |
| `service_pct`, `tax_pct` | numeric null |
| `show_service`, `show_tax`, `show_dp` | boolean, the existing per-invoice toggles |
| `dp_percent`, `dp_amount` | numeric null — the PRINTED line, not the tracking |
| `note` | text |
| `status` | `draft` / `issued` / `void` |
| `issued_at`, `issued_by` | set once, on issue |
| `voided_at`, `voided_by`, `void_reason` | |
| `created_at`, `updated_at` | |

**Why the guest details are copied rather than joined.** An invoice is a
statement of what was agreed on a date. If Ali later changes his booking to 25
people, the invoice he already holds still says 30. Joining live would silently
rewrite history; the voucher card already works this way and so does
`wa_campaigns.message_body`.

### `invoice_items`

`invoice_id`, `position`, `name`, `qty`, `unit`, `unit_price`, `amount`.

These lines **are** the pre-order (decision 3). No priced menu is needed.

### `invoice_versions`

The audit trail decision 2 requires.

`invoice_id`, `version`, `snapshot jsonb`, `changed_at`, `changed_by`,
`change_note`.

Every save **after** the invoice is issued writes a version containing the full
invoice and its items. Drafts do not; they are not evidence of anything yet.

**The risk this mitigates, stated plainly.** An edited invoice stops matching
the PDF already sitting in the guest's WhatsApp. In a dispute the guest's copy
is the one that was actually sent. The version history is what lets you answer
"what did we send Ali on 14 August?" instead of guessing. The record must show
**"edited after issue"** wherever it is displayed — a quietly-corrected invoice
is worse than no record at all.

### `invoice_payments`

The flexible half.

| Column | Notes |
|---|---|
| `id` | uuid pk |
| `invoice_id` | uuid → `invoices(id)` on delete cascade |
| `amount` | numeric. **Negative is legal** — that is how a refund is recorded |
| `paid_on` | date |
| `method` | text, free. "Transfer BCA", "Cash", "QRIS", whatever the restaurant says |
| `reference` | text null — a transfer reference or receipt number |
| `note` | text null |
| `recorded_at`, `recorded_by` | who keyed it in, which is not the same as who received it |

No enum on `method`. Constraining it is the same mistake as constraining the
deposit shape, and this schema has already taken a production outage from a
CHECK narrower than reality (see `CLAUDE.md`, "Two functions in this file can
drift apart").

### What is derived, never stored

```
paid        = sum(invoice_payments.amount) for the invoice
outstanding = invoices.total - paid
state       = outstanding <= 0        -> 'paid'
              paid > 0                -> 'partial'
              otherwise               -> 'unpaid'
```

**Do not add a `payment_status` column.** It would be a second truth that
drifts the moment someone edits or deletes a payment, and this codebase has
already been bitten by exactly that class of bug. Derive it in a view so every
screen agrees by construction:

```sql
create view invoice_balances as
select i.id, i.total,
       coalesce(sum(p.amount), 0)              as paid,
       i.total - coalesce(sum(p.amount), 0)    as outstanding
from invoices i
left join invoice_payments p on p.invoice_id = i.id
where i.status = 'issued'
group by i.id, i.total;
```

Void invoices are excluded: a voided document owes nothing.

---

## The follow-up model

Today `follow_up_done` is a boolean meaning "somebody contacted this guest".
Deposits do not fit that shape, and adding `dp_followed_up` and
`balance_followed_up` would hardcode the two-stage scheme that decision 3 says
does not generalise.

**Instead, an outstanding balance IS the task.** A reservation whose linked
invoice has `outstanding > 0` produces one item in the bell:

> Ali — Rocker Company · Rp 3.047.000 outstanding · issued 9 days ago

**Recording a payment is what clears it.** There is deliberately no "mark as
paid" tick.

That is the opposite of the choice made for birthday greetings, and the
difference is worth stating because it will look inconsistent otherwise: a
birthday greeting has no other record, so the tick **is** the evidence. A
payment has a record — the money — so a tick would be a competing truth that
can disagree with the arithmetic. Never offer a tick where a fact already
exists.

---

## Where it shows up

Decision 4, in the order it should be built.

1. **Badge on the reservation row.** `Rp 3.047.000 belum masuk` on the day
   list, so nobody preps 30 covers for a booking that was never paid for. This
   is the one that changes behaviour on the floor.
2. **Task in the bell**, beside the online-form follow-ups. Amount and age.
3. **Outstanding report** for a manager: which bookings owe money and how much
   in total. Monthly, not daily.

**Deliberately excluded:** a warning when staff mark the party Arrived with a
balance unpaid. Rere left this out. Worth revisiting if a restaurant reports
losing balances at the door, since that is the moment the money is easiest to
collect and the hardest to chase afterwards.

---

## What this is NOT

Naming these now prevents the scope creeping in later under the word "obvious".

- **Not an accounting system.** No ledger, no tax reporting, no bank
  reconciliation, no authority over receipt numbering.
- **It does not take payments.** No gateway. A human still sees the money
  arrive and keys it in. The app records claims about money, not money.
- **Not a pre-order system.** Decision 3. The invoice item lines are the
  pre-order, typed by staff.
- **Not a quote or contract flow.** No guest-facing approval, no signature.

---

## Risks and open questions

### 1. RLS, REWRITTEN 2026-09-05, and the risk is now accepted

The August text said RLS was disabled. It is not: it is enabled on ten tables and
nine of them carry a `USING (true)` policy, so the door is open anyway. Worse, the
staff app has **no database identity at all** — it authenticates a PIN in JavaScript,
so every request is the `anon` role. See `CLAUDE.md`, "Must be fixed before the first
sale".

So "a guest could write a payment row claiming they paid" is **literally true**, not a
hypothetical.

**Rere accepted this on 2026-09-05 and chose to build payments now.** The reasoning,
recorded so it is not silently re-litigated:

- Blue Heron is her own venue, and this exact risk was already accepted for guest data.
- These rows record money that **already arrived**, keyed in by staff. This is a
  bookkeeping ledger, not a payment gateway: a forged row is an error someone can spot
  against the bank, not stolen money.
- Real staff auth remains the thing that blocks the first paying client, and it does not
  get easier by delaying the deposit flow.

**What this means for whoever builds the rest of the invoice feature:** the acceptance
covers deposit payments on Rere's own venue. It does NOT extend to shipping invoices to
a paying client. Before that, staff auth lands.

### 2. Invoice numbering

Hand-typed today, and only same-browser duplicates can be warned about. With a
table, a unique index makes duplicates impossible across the whole restaurant —
a real improvement worth taking. Open: should the app also *generate* the next
number, or keep it typed to match whatever book the restaurant already uses?
Recommend: keep typed, enforce unique, offer a suggestion.

### 3. Editing an issued invoice

Decision 2 accepted the risk. Mitigations: version history, an "edited after
issue" marker wherever the invoice appears, and manager-only. Reconsider if a
client ever has a genuine dispute.

### 4. Which invoice belongs to the booking

A reservation can end up with several: a voided one plus its replacement, or a
deposit invoice plus a final invoice. The row badge should read from the
**non-void** invoices only, and show the sum if there is more than one.

### 5. Partial refunds and cancellations

A negative payment row covers a refund. What is NOT decided: what happens to a
deposit when a booking is cancelled. Keeping it, refunding it, or holding it as
credit is a restaurant policy, not a software rule. The app should record what
was done and not enforce a choice.

---

## Suggested build order

Each phase is independently useful and independently shippable.

| Phase | What | Rough size |
|---|---|---|
| 0 | RLS, or an explicit decision to accept the risk for one more client | see `CLAUDE.md` backlog 1 |
| 1 | `invoices` + `invoice_items` + `reservation_id`. Save, reopen and reprint an invoice from a booking. No money yet | 2–3 days |
| 2 | `invoice_payments` + the balances view + the reservation row badge | 2 days |
| 3 | Bell task and the outstanding report | 1–2 days |
| 4 | `invoice_versions` and the edit-after-issue trail | 1 day |
| 5 | Later, if a client asks: pre-order from a priced menu on the public form | not scoped |

Phase 4 is listed last only because it is small. **If issued invoices are
editable before the versioning exists, the audit trail has a hole in it for
exactly as long as that gap lasts** — so either ship 4 with 1, or keep invoices
frozen until 4 arrives.

## One thing worth reconsidering

Ali's story starts with a form that never asks his company name, so "Rocker
Company" arrives as free text in Notes and the invoice's Bill To has to be
retyped from it.

Adding one optional "Company / Organisation" field to the public booking form is
perhaps an hour of work, feeds `guests.company` which already exists, and makes
the invoice's Bill To fill itself. It is not part of this feature and it is the
cheapest single improvement to the journey described above.
