# Public booking form: areas, deposit and waitlist

**Status:** spec. Not built.
**Supersedes** `RESERVATION_DEPOSIT_PHASE1.md` sections 4, 5 and 9. Everything else in
that document still stands, in particular the schema in section 2 and the deposit
flexibility rules in section 8.
**Decisions taken** 2026-09-05 with Rere. Where a decision reverses something written
earlier, it says so.

---

## 1. What changed since phase 1 was written

Three things, and each one makes the build smaller rather than larger.

**The deposit is collected by QR, not by an auto-issued invoice.** Phase 1 section 9 had
the form minting a numbered financial document on submit, which dragged in RLS as a
prerequisite, per-phone rate limiting, a system `issued_by` sentinel, and a gap-tolerant
`ONL-` numbering series. A static QRIS image plus an amount mints nothing. All of that
falls away.

**Over-capacity is no longer a refusal.** A party of 25 asking for a 20-seat room is a
booking worth having, not an error. It becomes a waitlist entry an admin decides on.

**The deposit is a flat rupiah figure**, already built and live. `deposit_pct` is dead.

---

## 2. Decisions, settled

| # | Question | Decision |
|---|---|---|
| D1 | Party larger than the area's seats | **Waitlist.** Admin decides |
| D2 | Party below the area's minimum | **Waitlist.** Admin decides |
| D3 | Date already fully booked | **Refuse.** Tell them to message on WhatsApp |
| D4 | Where the deposit QR comes from | **One QRIS for the whole restaurant**, uploaded in Settings |
| D5 | Proof of payment | **WhatsApp only.** No upload on the public form |
| D6 | Which form fields are configurable | **Notes, Company, Area picker.** Name, phone and pax are fixed |
| D7 | Is choosing an area mandatory | **Yes, once at least one area is bookable.** No picker at all when none is |
| D8 | What capacity guests see | **Percentage, plus an estimated table count clearly labelled as an estimate** |
| D9 | Telling the waitlist reasons apart | **Store the reason on the booking** |
| D10 | Party above the global "largest party" | **Waitlist too.** No automatic refusal on size |
| D11 | Visual direction | **Theme presets the client picks**, not one fixed look |
| D12 | Page structure | **One page, sticky submit.** Not a multi-step flow |
| D13 | Where an area's rules appear | **A panel below the pills**, opened by picking an area |

### Why D6 excludes three fields

Name and phone create and match the guest record; phone is the key the duplicate guard
and the returning-guest lookup both use. Pax is what every capacity rule is checked
against. A settings screen offering five switches where three cannot move is a screen
that lies to the person reading it, so those three are simply not offered.

### Why D8 is an estimate and says so

Occupancy is counted in **pax** against `assigned_area`. Online bookings never receive a
table: `create_public_reservation` records the area the guest chose and nothing more,
because no human has seated them yet. A literal "tables available" figure would count
tables nobody is assigned to and would keep reporting the same number while the area
filled with online bookings, so it would be most wrong on the busiest night.

The estimate is `floor(remaining_pax / average table size in that area)`, and the copy
must carry the hedge: **"kira-kira 4 meja"**, never "4 meja tersedia". If an area has no
tables recorded, the count is omitted and only the percentage shows.

---

## 3. Schema

Additive. Safe during service, safe to run twice.

```sql
-- Waitlist is a real status, not a flag, so a booking cannot be both.
alter table public.reservations
  add column if not exists waitlist_reason text;

comment on column public.reservations.waitlist_reason is
  'Why this booking is on the waitlist: over_capacity, below_min_pax or over_max_pax. Set by create_public_reservation, never by hand. NULL on every booking that was accepted outright.';
```

And the status constraint gains one value:

```sql
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations
  add constraint reservations_status_check
  check (status in ('Reserved','Confirmed','Waitlist','Arrived','Cancelled',
                    'Cancelled (No Show)','No Show','Completed','Deleted'));
```

### `Waitlist` must NOT hold a seat

`RES_HOLDS_SEAT_STATUSES` is `["Reserved", "Confirmed", "Arrived"]` and **Waitlist does
not join it.** A waitlisted booking has not been accepted, so it must not consume
capacity: otherwise a run of waitlist requests quietly blocks the real bookings behind
them, and the area reports itself full when it is not.

It does not join `RES_OCCUPANCY_STATUSES` either, so it stays off the run sheet until an
admin accepts it. It **must** appear in the reservations list and in a worklist, or it is
a booking nobody ever sees.

There are two lists to walk when adding this status, and a third that is easy to miss:
the reservations list filter, the occupancy queries, and `js/notify.js`, which spells the
status list out separately for the bell.

### New settings keys

All under existing `app_settings` rows, **merged key by key, never assigned**. This row
has already lost data once by being rebuilt from scratch.

| Key | Row | Default | Meaning |
|---|---|---|---|
| `deposit_qr_url` | `appearance` | null | The uploaded QRIS image. Null means no QR is shown and the form falls back to "staff will follow up" |
| `deposit_qr_note` | `appearance` | null | Optional line under the QR, e.g. the account name |
| `form_show_notes` | `reservation_form` | true | D6 |
| `form_show_company` | `reservation_form` | false | D6 |
| `form_show_area` | `reservation_form` | true | D6. Only consulted when an area is bookable |
| `form_show_capacity` | `reservation_form` | false | D8. Off by default |

---

## 3b. Look and feel

### D11: presets, not one design

Rere's concern was that Intoch's form should not look like Blue Heron's. Drawing one
different design solves that once; a **theme the client picks in Settings** solves it
permanently, and it is the honest shape for a product sold to many restaurants. Blue
Heron keeps the look it has, and the next client picks their own.

Three presets to start: **dark glass** (what exists today), **light**, and **solid
colour**. A preset sets the background treatment, panel style and text colour together,
so a client cannot assemble an unreadable combination out of individual switches.

Stored as one key, `reserve_appearance.theme`, beside the existing `logo_url`,
`bg_image`, `glass` and `logo_max_h`. An unknown or missing value falls back to dark
glass, which is what every existing deployment already renders.

### The contrast rule, which is not negotiable

Every restaurant uploads its own background photo and **we cannot test any of them**.
A bright photo behind pale text is unreadable outdoors on a phone, which is exactly where
this form gets used.

So: the scrim over the background image is **fixed by the theme, never by the image**,
and never removable from Settings. A client may change the photo and the theme; they may
not turn off the layer that keeps the text legible. Check every preset against a
deliberately terrible photo (bright, high-contrast, busy) before shipping, not against
the tasteful stock image bundled with the repo.

The solid-colour preset exists partly for clients with no usable photograph, and it must
be a genuinely supported option rather than a fallback nobody maintains.

### D12: one page

Seven fields. The reference designs that split into three steps collect far more (email,
dietary restrictions, seat preference, occasion). Splitting seven fields across three
screens adds taps and quietly breaks the "hanya butuh 1 menit" promise the page makes at
the top of itself. There is already a natural second screen: the result, where the
deposit or the waitlist message lives.

### The welcome line becomes editable

It currently reads "Hanya butuh 1 menit, reservasi dengan cepat, sampai jumpa!" and is
hardcoded. Moves to `reserve_appearance.welcome_text`. It is client-typed text rendered
on a public page, so: escape it, cap the length, fall back to the current sentence when
blank, and **do not run it through the translation dictionary** — it is the client's own
words in their own language.

### Area pills

Three per row as Rere asked, but the longest area name today is already "Indoor Dining -
No Smoking", which will not fit in roughly 100px on a 360px phone. The pill row wraps and
drops to two per row when any name exceeds the fit, rather than truncating a name to
something a guest cannot tell apart from another area.

### D13: the conditions panel

Picking an area opens a panel directly beneath the pills carrying that area's minimum
party, minimum spend, deposit and, when `form_show_capacity` is on, its availability.

The deposit figure **must be visible before the guest submits**. This is the one place
the form asks for money, and phase 1 P1-O3 already established the principle: a charge
must never first appear at the table. The same reasoning applies to a charge that first
appears after submitting.

### The sticky submit button

Sticky footer plus the iOS keyboard tends to cover the field being typed into, which on
this form is the notes box directly above it. Test on a real phone, not the responsive
preview in devtools.

---

## 4. The public form

Order on the page: name, phone, date, time, **area**, pax, then company and notes if
switched on. Area sits above pax because pax is judged against the chosen area.

Each area option shows its own conditions in Indonesian, for example:

> **Indoor Dining** · min. 4 orang · min. belanja Rp 1.500.000 · DP Rp 500.000

With `form_show_capacity` on, each option also carries availability:

> Sudah 60% terisi · kira-kira 4 meja

**Fallback, inherited and unchanged:** if no area has `is_bookable_online = true`, the
picker is not rendered at all and the form submits with a null area exactly as today.
D7's "mandatory" applies only when there is something to choose.

### Availability must not be read from the reservations table

The form needs to know how full each area is. It must NOT get that by selecting from
`reservations`: that would have a public page reading every guest's booking to render a
percentage. Add a `SECURITY DEFINER` function returning aggregate availability per area
for one date, and nothing else:

```
public.area_availability(p_date date)
  -> [{ area_id, capacity, reserved_pax, pct_full, est_tables }]
```

Reads only areas with `is_bookable_online = true`. Returns no guest data of any kind.

### Client-side checks are convenience only

pax below the minimum, pax above capacity, area not bookable: every one is re-checked in
the RPC. The form is public and anyone can post whatever they like straight to Supabase,
which matters more than usual while the anon key is the only barrier (see
`intoch-rls-and-staff-auth` in project memory).

---

## 5. `create_public_reservation`

Signature is unchanged: `p_area_id` and `p_company` already exist and are already
defaulted, so an older deployed page keeps working.

### Order of checks, and why

1. **Paused / closed / lead time / horizon** exactly as now. A closed restaurant refuses
   before a guest row is created.
2. **Nonsense pax.** `p_pax` null or below 1 still refuses outright. That is bad input,
   not a large party.
3. **Bigger than the whole restaurant.** Refuse `pax_impossible` when the party exceeds
   the total seats across all areas. This is not the "largest party" setting, and it is
   not a business judgement: no decision an admin could make would seat them, so putting
   it on a waitlist would only promise a human review that can end one way. It also stops
   a public form creating a waitlist row for 99,999 people. If no area has a capacity
   recorded, this check is skipped rather than guessing.
4. **Area valid and bookable.** Refuse `area_unavailable`.
5. **Date full for that area.** Refuse `date_full`.
6. **Party vs the rules.** Global `max_pax`, the area minimum, and the area capacity.
   **None of these refuse any more.** Each sets the outcome to Waitlist.

Step 5 before step 6 is deliberate: a full night is a "no" whatever the party size, and
telling a guest they are on a waitlist for a night that cannot take them is worse than a
clean refusal.

**`max_pax` is no longer a refusal (D10).** It was `Pax must be 1-20 (larger groups:
contact us on WhatsApp)`. It becomes the point past which a booking needs a human to say
yes. Rere accepted that a party of 200 therefore lands in the waitlist rather than being
turned away, which is why step 3 exists as the one hard size limit.

### Outcomes

| Situation | Status | `waitlist_reason` | Guest is told |
|---|---|---|---|
| Fits every rule | `Reserved` | null | Booking received |
| Pax > area capacity | `Waitlist` | `over_capacity` | Request received, staff will confirm |
| Pax < area minimum | `Waitlist` | `below_min_pax` | Request received, staff will confirm |
| Pax > global `max_pax` | `Waitlist` | `over_max_pax` | Request received, staff will confirm |
| Area unknown or not bookable | refused, `area_unavailable` | — | Pick another area |
| Area full that date | refused, `date_full` | — | Full, please message us on WhatsApp |
| Bigger than the restaurant | refused, `pax_impossible` | — | Too large to seat, please message us |

**Every code needs `ERR_ID` copy added in the SAME change.** The guest page maps an
unknown code to "connection problem, try again", so a guest would retry forever against
a refusal that will never change. `tests/reservation-availability.test.js` currently
fails one assertion for exactly this reason and closes when this lands.

### Deposit

Unchanged from what is already live: `deposit_required` and `deposit_expected` are
snapshotted from the area's flat `deposit_amount` at booking time, and never derived on
read. Editing the figure in Settings next month must not rewrite what a past guest was
quoted.

**A waitlisted booking still snapshots its deposit but must not ask for payment yet.**
The guest has not been accepted, so the QR is shown only once staff confirm. Taking money
for a booking that may be declined is the one genuinely bad outcome available here.

---

## 6. What the guest sees after submitting

Three cases, and they must read differently. A waitlist entry that looks like a
confirmation is the failure mode to design against.

**Accepted, no deposit.** As today.

**Accepted, deposit applies.** The amount, the QR, and a line saying to send the transfer
proof on WhatsApp. State plainly that the booking is held pending the deposit.

**Waitlisted.** No QR, no amount, and wording that does not read as a confirmation:
the request is received, the party size is outside what this area normally takes, and
staff will confirm. It must be obvious they do not yet have a table.

---

## 7. Staff side

The reservations list gains waitlist entries, visibly distinct, showing the reason in
words rather than the stored code: "terlalu besar untuk area" or "di bawah minimum".

Accepting one sets the status to `Reserved` (or `Confirmed` if a deposit is paid) and
clears nothing: `waitlist_reason` stays as the record of why it was ever held. Declining
follows the existing cancel path.

Accepting a waitlisted booking is the moment its deposit becomes payable, so that is
where the QR link or the WhatsApp message belongs.

---

## 8. Open items

**O1. RESOLVED 2026-09-05: `max_pax` becomes a waitlist trigger.** It no longer refuses
anything. The Settings label and helper text must change with it, because "Largest party"
currently reads as a hard limit and would now mean "the size past which we want to decide
by hand". Something like **"Ask us first above"** is closer to what it now does. The old
helper text ("A party larger than this is told to contact you on WhatsApp instead") is
now wrong and must be rewritten in the same change, along with its Indonesian entry.

**O2. Does a waitlisted booking count against `date_full` for the next guest?** It holds
no seat by section 3, so it does not, which is correct while it is pending. It does mean
an area can accumulate more waitlist requests than it could ever seat.

**O3. Duplicate guard and waitlist.** The one-open-booking-per-phone-per-day check counts
`Reserved` and `Confirmed`. Should a pending waitlist request block the same phone from
booking again that day? Probably yes, or a guest refused a big table simply books twice.

**O4. Who can accept a waitlist entry?** Any staff member, or manager only? The deposit
waiver rule in phase 1 P1-O3 chose "any staff member, no manager gate", which suggests
the same here.

---

## 9. Tests this needs

Mirroring `tests/reservation-availability.test.js`, on throwaway Postgres.

1. No bookable area anywhere: no picker, RPC still accepts a null area
2. One bookable area: picker renders, a null area from an older page is still accepted
3. Pax above capacity lands as `Waitlist` with `over_capacity`, not an error
4. Pax below the minimum lands as `Waitlist` with `below_min_pax`
5. A waitlisted booking does NOT appear in the occupancy summary or the run sheet
6. A waitlisted booking DOES appear in the reservations list
7. A full date refuses with `date_full` before any waitlist outcome is reached
8. The availability gate still fires first on a paused restaurant
9. Deposit snapshot stored, then settings changed: the stored figure does not move
10. A waitlisted booking is not shown a QR or asked for payment
11. Every code the function can return has an `ERR_ID` entry
14. Pax above `max_pax` lands as `Waitlist` with `over_max_pax`, and is NOT refused
15. Pax bigger than every area combined is refused with `pax_impossible`, not waitlisted
16. Pax of 0 or null is still refused outright, not waitlisted
12. `area_availability()` returns no guest data
13. The settings row is spread, not rebuilt, when the new form keys are saved

Note the `ALL_IN_ONE.sql` trap: the function is defined more than once, so slice it with
`lastIndexOf` **and** bound the end at `$function$;`, or the confirm block gets swept into
the slice.
