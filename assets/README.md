# Assets

**Every image here is a grey placeholder.** Filenames and pixel dimensions match the
originals so layouts hold and nothing breaks, but all of them need replacing with the
product's own artwork.

The originals were Blue Heron's logo, their restaurant photography and their voucher card
design. Client artwork does not belong in a product repo.

`voucher-bg.jpg` needs the most care: `js/voucher.js` draws text onto it at fixed
coordinates (safe band roughly y470 to y1660 on a 1084x1940 canvas). A replacement must
either keep those dimensions or the draw positions must be re-tuned.
