# Supabase in Intoch, explained simply

You do not need to understand database programming to understand the important parts of
this system.

## The basic idea

Intoch has two main parts:

1. **The website** is what staff see and click.
2. **Supabase** is where the restaurant's information and login system live.

The website does not keep the restaurant's main records by itself. When somebody opens a
reservation, saves a guest or records a payment, the website asks Supabase to do it.

```text
Staff clicks something in Intoch
              ↓
Intoch sends a request to Supabase
              ↓
Supabase checks who the staff member is and what they may do
              ↓
Supabase either performs the request or refuses it
              ↓
Intoch shows the result
```

## Is there an API?

Yes. An API is simply a controlled way for one piece of software to ask another piece of
software for something.

Intoch uses Supabase's API. The developers normally do not write the raw internet request.
They use Supabase's JavaScript library, which prepares the request for them.

For example, the code may effectively say:

> “Supabase, please give me today's reservations.”

or:

> “Supabase, please record that this invoice was paid.”

So “the browser talks directly to Supabase” does **not** mean there is no API. It means we use
Supabase's ready-made API instead of maintaining a separate Intoch server for every ordinary
request.

## A restaurant analogy

Think of the Intoch screen as a waiter and Supabase as the kitchen plus the locked records
office.

- The waiter may ask for an order, but does not decide the kitchen's rules.
- Every request passes through the service window—the API.
- The staff badge identifies who is making the request—Supabase Auth.
- The access rules decide which rooms and files that person may use—database permissions and
  Row Level Security.
- Important procedures must follow a set recipe—database functions, called RPCs.
- The master key stays in the manager's office—the secret service-role key stays on the
  server.

Someone can see where the service window is. That does not mean they are allowed into the
kitchen or records office.

## Is the public key a password?

No. The website contains a Supabase **publishable key**. Anyone who opens the website can
technically see it, and that is expected.

The publishable key identifies which Supabase project the website wants to contact. It does
not, by itself, grant unlimited access. Supabase must still check:

- Is this person signed in?
- Which staff account are they?
- Is the account still active?
- Is their role Staff, Finance, Manager, Admin or Owner?
- Is that role permitted to perform this exact operation?

The truly powerful **service-role key** is different. It can bypass normal database
restrictions. It must never be placed in the website. In Intoch it is intended to exist only
inside the server-side `staff-account` function, where it is needed to create accounts and
change PINs.

## What protects the information?

Hiding buttons is not security. A determined person can alter a website in their own browser.

The real protection must happen inside Supabase:

- **Authentication** confirms who signed in.
- **Database permissions** define what a role can generally do.
- **Row Level Security (RLS)** decides which records the person may read or change.
- **Database functions** protect important multi-step actions such as payments, arrivals and
  membership transactions.
- **Storage policies** protect uploaded files.

This means that even if someone avoids the Intoch screen and sends their own request, the
database should still refuse anything they are not allowed to do.

## Why are some actions handled differently?

Simple actions can go directly through Supabase's database API. Examples include loading a
permitted guest list or updating an allowed setting.

Important actions use a protected database procedure. For example, recording a payment may
need to:

1. Confirm the staff member has permission.
2. Record the payment.
3. Recalculate the outstanding balance.
4. Change the reservation state only when the rules allow it.
5. Complete all of this together so it cannot stop halfway through.

That protected procedure is called an **RPC** in the code. You can think of it as asking
Supabase to follow an approved recipe instead of letting the browser perform every step.

## What is the Edge Function?

Most Intoch requests go from the browser directly to Supabase's database API. One important
exception is staff account management.

Creating an Auth account or changing its PIN requires powers that must never be placed in a
browser. Intoch therefore has a small server-side program named `staff-account`:

```text
Admin screen → staff-account server function → Supabase Auth
```

The function first checks that the caller is a valid Admin. Only then does it use the secret
server key to perform the account operation.

## Is Intoch secure right now?

The repository contains the intended security design: authenticated staff identities, roles,
RLS policies, guarded database functions and a server-side account function. The design can
be secure without a traditional custom backend.

However, the repository cannot prove what is currently installed in every live Supabase
project. Database updates and the Edge Function are deployed separately from the website.
Therefore the honest answer is:

> The code contains the intended protections, but each live client project must be checked
> before we claim its deployed database is fully up to date and secure.

This is not evidence that a project is unsafe. It means deployment needs verification, just
as checking architectural plans does not prove that every lock was installed in the building.

## What happens during common tasks?

### A staff member logs in

1. They enter their username and PIN.
2. Supabase Auth checks the credentials.
3. Intoch checks that the linked staff record is active.
4. Supabase remembers the signed-in session and attaches it to later requests.
5. Intoch regularly checks that the session and account are still valid.

### Staff opens the reservation list

1. Intoch asks Supabase for the permitted reservations.
2. Supabase checks the signed-in staff member and database rules.
3. Supabase returns only the allowed result or returns an error.
4. Intoch displays the list.

### Staff records a payment

1. Intoch calls a protected database procedure.
2. The database checks identity, role and payment rules.
3. The database records the transaction and related state changes together.
4. It returns a result that Intoch displays.

### An Admin creates a staff account

1. Intoch calls the server-side `staff-account` function.
2. The function confirms the caller is an active Admin.
3. The server uses its secret key to create the Auth identity.
4. The new identity is linked to the staff record and role.

## The five things worth remembering

1. **Yes, Intoch uses an API:** it uses Supabase's API through its JavaScript library.
2. **The browser normally talks directly to Supabase:** that is an intentional design, not a
   missing component.
3. **The publishable browser key is not a secret:** database rules provide the protection.
4. **The database must make the final permission decision:** hiding a button is never enough.
5. **Live deployment must be checked separately:** code in Git does not prove that every
   Supabase project has received every security update.

If you later need implementation details or code examples, continue to
[How Intoch connects to Supabase](SUPABASE_GUIDE.md). That document is the developer
reference; this page is the conceptual overview.
