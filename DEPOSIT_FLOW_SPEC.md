# Deposit flow: Incoming, chasing, and locking a booking

**Status:** spec. Not built. Decisions taken 2026-09-06 with Rere.
**Supersedes** the deposit half of `RESERVATION_FORM_SPEC.md` sections 5 and 6, and
replaces the "one QRIS on the public form" idea entirely.
**Depends on** `invoice_payments` and `reservation_deposit_balances`, already built.

---

## 1. What this is

Today a deposit is a number the guest is shown and nobody can settle. This makes it a
worked process: a booking that owes money is visibly *not secure* until a human confirms
the money arrived.

**Self-service payment is explicitly out of scope.** No QR on the public form, no
webhook, no gateway. Every deposit is confirmed by a person reading a WhatsApp reply.
That is a deliberate simplification, not a gap to be filled later without asking.

```
Area has a deposit?
  no  →  Reserved → Arrived → Finished          (exactly as today, untouched)
  yes →  Incoming → Reserved → Arrived → Finished
         ↑ unpaid   ↑ staff confirmed the money
```

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where an unpaid deposit booking lands | **`Incoming`**, a new status |
| D2 | Does `Incoming` hold seats | **Yes.** The table is held while they pay |
| D3 | A booking nobody pays for | **Auto-cancels at a deadline** |
| D4 | The deadline | **The booking's own date and time.** Pay before you eat |
| D5 | Who confirms payment | A human, reading a WhatsApp reply. `Incoming → Reserved` by hand |
| D6 | The invoice preview link | **Anyone with the link.** Long unguessable id, no login |
| D7 | Payment details | Bank details as text **and** a QRIS image in Settings, **and** a per-invoice note |
| D8 | Cancelling a paid booking | Modal: "is it refunded?" Staff must acknowledge. We do not move the money |
| D9 | Who may release an invoice | **Manager and admin only** (`isManagerOrAdmin()`). Staff may still see and change bookings |
| D10 | Waiving a deposit | **Any staff member, with a required reason.** Adding one is out of scope |

### D4. The deadline is the reservation itself

```
deposit_due_at = reservation_date + reservation_time
```

That is the whole rule. Book at 13:00 for 19:00 tonight and you have until 19:00. Book in
March for June and you have until June. The guest may pay from the moment staff send the
invoice until the hour of the booking.

An earlier draft had a configurable 24-hour grace clamped against the reservation time.
It was deleted: it needed a settings field, a `min()`, and a special case for bookings
sooner than the grace period, all to express something less obvious than "pay before you
eat". **Do not reintroduce `deposit_grace_hours`.**

**What this costs, stated plainly.** A booking three months out holds its seats for three
months on an unpaid deposit. Accepted: a table three months away is not scarce, the
Incoming list shows it the whole time, and staff can cancel by hand. If it ever becomes a
problem the answer is working that list, not a second deadline.

### The one race this creates

The guest pays at 18:55, staff key it in at 19:05, and the sweep cancelled the booking at
19:00. The rule that the sweep **never expires a booking with a payment recorded** does
not help, because the payment had not been recorded yet.

Accepted rather than engineered around: a booking cancelled by expiry can be moved back
by staff, and `deposit_expired_at` tells them it was the system rather than a person that
cancelled it. Anything cleverer means holding tables past the sitting on the chance
somebody is mid-transfer.

### D9 rationale

Rere's words: staff "can see and change booking but might not be able to release an
invoice". This is the ladder that already exists, so it costs one guard rather than a new
role. She offered to drop the restriction; keeping it is cheaper than removing it, and
"anyone can issue financial documents" is a poor default to hand a paying client.

**No `finance` role, and no capability flag.** An earlier draft of this spec had both,
from a misreading. Do not reintroduce them without a reason that is not this one.

### D10. Waiving a deposit

Rere's case: a guest of the chef is told not to pay. Staff need to release the booking
without money.

The action moves the booking `Incoming → Reserved`, sets `deposit_required = false`, and
writes who waived it, when, and **why** into `deposit_rule_note`. The reason is a
required free-text field.

**Why the reason is not optional.** `deposit_rule_note` exists so a waived deposit is
distinguishable from one that was never required — without it a report cannot tell "this
area asks for nothing" from "somebody comped it". An unexplained waiver is
indistinguishable from a mistake, and the ones most worth explaining are the ones most
likely to be left blank if the field is skippable. Do not make it optional later as a
friction fix.

**The permission is deliberately inverted, and Rere chose it knowingly.** Staff may waive
a deposit but may NOT release an invoice (D9), so the junior role can give money away but
not ask for it. That is backwards from the usual risk direction. It stands because the
floor case is real — the chef's guest is standing there — and because the required reason
plus a permanent record is the control instead. If the record is ever weakened, revisit
this together.

**Waiving does not delete payments.** If a partial payment was already recorded and the
rest is then waived, the payment rows stay exactly as they are. Money that arrived is a
fact; the waiver only changes what is still owed.

A waived booking is `Reserved`, so the expiry sweep never sees it.

**Adding a deposit to a booking that did not need one is out of scope** (D10). It means
telling a guest who was told they owed nothing that they now owe money, which phase 1
P1-O3 said needs its own confirmation step and follow-up task. Build it when it is
actually wanted, not speculatively.

---

## 3. Schema

```sql
-- Bookings awaiting a deposit. NOT a flag: a booking cannot be both Incoming
-- and Reserved.
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations
  add constraint reservations_status_check
  check (status in ('Reserved','Confirmed','Waitlist','Incoming','Arrived','Cancelled',
                    'Cancelled (No Show)','No Show','Completed','Deleted'));

alter table public.reservations
  add column if not exists deposit_due_at    timestamptz,
  add column if not exists deposit_expired_at timestamptz,
  add column if not exists deposit_asked_at  timestamptz;
```

**Both places that define the status constraint must be changed.** `ALL_IN_ONE.sql`
re-asserts it about 3700 lines before the deposit section, and a re-run against a
database already holding `Incoming` rows aborts if the two disagree. This has already
happened once, with `Waitlist`.

| Column | Why |
|---|---|
| `deposit_due_at` | When this booking expires if unpaid: the reservation's own date and time. Stored rather than derived so the sweep is one indexed comparison, and so that moving a booking's time later is a deliberate act with a visible effect |
| `deposit_expired_at` | Set when the sweep expires it. Distinguishes "cancelled because nobody paid" from "cancelled by a person", which the cancellation reason alone cannot |
| `deposit_asked_at` | When staff last sent the invoice on WhatsApp. Drives "DP diminta 3 hari lalu". A FACT (a message was sent), not a tick |

### `Incoming` holds a seat

`RES_HOLDS_SEAT_STATUSES` becomes `["Reserved", "Confirmed", "Incoming", "Arrived"]`.

This is the point of D2 and it must be changed in every place that list appears, plus
the `date_full` check inside `create_public_reservation` and the `area_availability()`
function, both of which spell the statuses out inline.

**Getting this wrong is silent both ways.** Leave `Incoming` out and you oversell the
room to someone who pays while the first guest is still transferring. Put `Waitlist` in
by accident and a queue of unpaid requests blocks the bookings behind it.

### `Confirmed` is now unused

Nothing set it before and nothing sets it now: `Incoming → Reserved` covers what it was
imagined for. It stays in the constraint (removing a value from a CHECK breaks any row
that has it) and keeps its badge, but no code path produces it. Say so in a comment
rather than leaving the next person to wonder.

---

## 4. Creating a booking

`create_public_reservation` decides the status at the end, after the waitlist rules:

```
if the chosen area has deposit_amount > 0:
    status = 'Incoming'
    deposit_due_at = per D4a
else:
    status = 'Reserved'      (unchanged from today)
```

**Waitlist wins over Incoming.** A booking that is too big for the area is not yet a
booking at all, so it stays `Waitlist` with no deadline. Its deposit clock starts when
staff accept it, not before, or a guest could be auto-cancelled for failing to pay a
deposit on a booking nobody had agreed to.

The form already shows the deposit before submitting, so no change there. The
confirmation page must say the booking is **held pending payment** and that staff will
send the details, rather than implying it is secure.

---

## 5. The staff flow

### The Incoming list

A filter chip beside Reserved, per D-item 5 of Rere's brief. Each row shows the amount
owed, how long it has been waiting, and when it expires. Sorted by expiry, soonest first:
the list is a worklist, so the thing about to be lost belongs at the top.

An overdue row is visibly overdue before the sweep touches it.

### Generating and sending the invoice

Manager or admin only (D9). One action produces three things:

1. An `invoices` row: amount, the booking it belongs to, the note (D7), and a token.
2. A **preview link** — `deposit-invoice.html?t=<token>` — showing the restaurant's logo,
   the guest's name, date, party size, amount, bank details, QRIS image and the note.
3. **WhatsApp opens** with a message containing that link, using the existing `wa.js`
   helpers.

Sending sets `deposit_asked_at`. That is a record of an action, not a checkbox.

The token is a random 32-character id, not the reservation id. A sequential or guessable
id would let anyone walk the list of a restaurant's bookings. It is the only thing
protecting the page (D6).

### Confirming payment

The guest replies on WhatsApp. Staff record the payment — amount, date, method,
reference, note — into `invoice_payments` against the reservation, which the
`reservation_deposit_balances` view already turns into `unpaid / partial / paid`.

**Recording a payment that clears the balance moves the booking to `Reserved` in the
same action.** One step, so it cannot be half-done. A partial payment leaves it
`Incoming` with the balance shown, and **does not extend the deadline** — otherwise a
guest could hold a table indefinitely by sending Rp 1.000 a day.

### Cancelling

- Cancelling an **`Incoming`** booking: no modal. Nothing was paid, nothing to refund.
- Cancelling a booking with **any payment recorded**: the modal from D8, "Sudah
  direfund?", which cannot be dismissed by clicking away. Staff answer, and the answer
  is written to the cancellation note.

The modal does not move money and does not pretend to. It exists so nobody cancels a
paid booking without being asked the question out loud. Rere: "Its hole-y but it works
for now atleast." Recorded so the hole is a known one.

---

## 6. Expiry

A sweep sets `status = 'Cancelled'`, `deposit_expired_at = now()`, and a cancellation
note saying the deposit went unpaid, for every `Incoming` booking past `deposit_due_at`.

**How it runs is an open question, see section 8.** The important part is what it must
never do: expire a booking with any payment recorded against it, even a partial one.
Somebody who has sent money is a conversation, not a cleanup job.

---

## 7. Settings

Under Settings > Formulir Reservasi, beside the existing controls:

| Field | Notes |
|---|---|
| Bank details | Free text. Bank, account number, account holder |
| QRIS image | Uploaded like the background photo. Both this and the bank details show |

There is deliberately no deadline setting: the deadline is the booking's own time (D4).

If neither bank details nor a QRIS image is set, the invoice page has nothing to pay
into, so **generating an invoice must refuse with that reason** rather than sending a
guest a page that cannot be acted on.

---

## 8. Open questions

**O1. RESOLVED 2026-09-06: `pg_cron`, with an on-load sweep as the fallback.**

Checked on the live Intoch project: `pg_available_extensions` lists `pg_cron`, so it can
be installed. It is **not yet enabled** — enable it from Database → Extensions in the
dashboard rather than by hand, so Supabase puts it in the right schema. Enabling it does
nothing on its own.

The job calls one function every few minutes. That function is also called when the staff
app loads, so a client project WITHOUT cron still self-heals: same code, two triggers,
and nothing to reimplement if a future client is on a plan that lacks it.

**Check this per client, not once.** `can_install` is a property of the project, and a new
deployment is a new project.

**O2. Accepting a waitlisted booking in a deposit area.** It should become `Incoming`
with the clock starting at acceptance. Confirm before building.

**O3. RESOLVED 2026-09-06.** Staff may waive, with a required reason. See D10.

**O4. Editing the amount.** If a party shrinks from 20 to 8, does the deposit change?
The figure is snapshotted at booking time on purpose, so today it would not.

---

## 9. Tests this needs

1. A booking in an area with no deposit is created `Reserved`, not `Incoming`
2. A booking in a deposit area is created `Incoming` with a `deposit_due_at`
3. `deposit_due_at` equals the reservation's own date and time, not a fixed offset
4. `Incoming` counts toward `date_full` and `area_availability`
5. `Waitlist` still does NOT count, and a waitlisted booking gets no deadline
6. A payment clearing the balance moves the booking to `Reserved` in one action
7. A partial payment leaves it `Incoming` and does not move the deadline
8. The sweep never expires a booking with any payment recorded
9. The sweep sets `deposit_expired_at`, distinguishing it from a human cancellation
10. Generating an invoice is refused for staff, allowed for manager and admin
11. Generating an invoice is refused when no payment details are configured
12. The invoice token is random, not the reservation id
13. Every definition of `reservations_status_check` includes `Incoming`
14. Cancelling an `Incoming` booking shows no refund modal; cancelling a paid one does
15. Waiving moves the booking to `Reserved`, clears `deposit_required`, and records the
    reason, the person and the time
16. Waiving is refused with no reason given
17. A waived booking is never touched by the expiry sweep
18. Waiving after a partial payment leaves the payment rows untouched
19. Any staff role may waive; only manager and admin may release an invoice
