# Assets

## Real artwork (Intoch)

- `full-logo.png`  — the wordmark. Page headers, the invoice header, the
  reservation-confirmation canvas, the spin page.
- `small-logo.png` — the compact mark. Favicons, apple-touch-icon, the spin
  wheel centre, the small decorative mark on the invoice.
- `background-generic.jpg` — backdrop for the public reservation pages. Dark
  with a warm centre, so the CSS filter is a light `brightness(0.85)`; the
  previous backdrop was a bright dawn shot that needed `0.68`.

## Placeholders (grey boxes)

Everything else is a grey placeholder at the original pixel dimensions, so
layouts hold and nothing breaks. They came from Blue Heron's own photography
and branding, which does not belong in a product repo.

## Still carrying Blue Heron's design

`voucher-bg.jpg` is Blue Heron's cream voucher card, and `js/voucher.js` draws
text onto it at fixed coordinates (safe band roughly y470-y1660 on a 1084x1940
canvas). Swapping it for a differently-sized image means re-tuning those draw
positions. **The voucher card is not client-ready.** See CLAUDE.md, backlog
item 2.

`og-share.jpg` is the WhatsApp link-preview image and is also still a
placeholder. It is what guests see when someone forwards the booking link.
