---
name: Intoch landing page
description: A calm restaurant guest-history demonstration on white and navy.
colors:
  primary: "#3c56a6"
  primary-hover: "#304687"
  navy: "#102848"
  footer: "#070b11"
  paper: "#fff"
  soft: "#f4f7fb"
  tint: "#edf2fc"
  text: "#142137"
  text-secondary: "#52627b"
  line: "#dce3ed"
  inverse-muted: "#c7d8ed"
  highlight: "#b9d5ff"
  success: "#357648"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "clamp(2.35rem,4.3vw,3.7rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-.035em"
  headline:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "clamp(1.85rem,3vw,2.65rem)"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-.035em"
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-.035em"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "16px"
    lineHeight: 1.7
  label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 700
  data:
    fontFamily: "Source Code Pro, monospace"
rounded:
  panel: "28px"
  stage: "24px"
  pill: "999px"
spacing:
  compact: "8px"
  control-gap: "12px"
  mobile-gutter: "20px"
  panel-padding: "28px"
  section: "80px"
  mobile-section: "52px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "13px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-contact:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy}"
    rounded: "{rounded.pill}"
    padding: "13px 24px"
  product-panel:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "28px"
  feature-panel:
    backgroundColor: "{colors.soft}"
    rounded: "{rounded.panel}"
    padding: "28px"
  scenario-tab:
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "10px 22px"
  scenario-tab-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy}"
    rounded: "{rounded.pill}"
---

# Design System: Intoch landing page

## Overview

**Creative North Star: "One Guest History"**

Intoch presents restaurant workflows through readable guest history and short, inspectable demonstrations. The visual character is calm, practical, and softly rounded: white provides breathing room, navy concentrates attention, and logo-blue actions remain easy to find.

This system applies only to `landing.html` and its landing styles and scripts. The authenticated application retains its incumbent visual system; these tokens do not authorize an app redesign. The approved direction is recorded in `docs/design/landing.md`; brand constraints come from `PRODUCT.md`.

**Key Characteristics:**
- White canvas with uniform navy content sections and a near-black footer.
- Actual Intoch logo, Plus Jakarta Sans, selective headline emphasis.
- Soft product panels, pill controls, compact accessible tabs.
- Illustrative workflow demonstrations with explicit playback controls.

## Colors

The palette combines logo-blue actions with restrained navy contrast and pale-blue emphasis.

### Primary
- **Logo Blue:** Primary actions and selected states on white; deeper blue supplies hover feedback.
- **Pale Blue:** Selective headline and data emphasis on navy.

### Neutral
- **Uniform Navy:** Guest preview, scenario section, and contact section.
- **Near Black:** Footer only.
- **Paper and Soft Surface:** White canvas and quiet comparison, feature, and benefit surfaces.
- **Ink and Secondary Ink:** Headings and supporting copy on light surfaces.
- **Muted Inverse:** Supporting text on navy.
- **Divider:** Light-surface separators and borders.

Success green is reserved for simulated confirmation states, not a second marketing accent. Simulated WhatsApp screens retain contextual chat colors.

**The Single Navy Rule.** Dark content sections share the same navy; do not introduce a lighter blue outer shell.

## Typography

**Display Font:** Plus Jakarta Sans, sans-serif.
**Body Font:** Plus Jakarta Sans, sans-serif.
**Data Font:** Source Code Pro, monospace, for dates, times, and selected simulation data.

### Hierarchy
- **Display:** Heavy, balanced hero headline using the frontmatter display role.
- **Headline:** Section headings using the frontmatter headline role.
- **Title:** Product and feature headings; scenario titles use a responsive size and reduce to 1.6rem on mobile.
- **Body:** Comfortable default reading rhythm; hero supporting copy uses 17px and 1.8 line-height, reducing to 16px on mobile.
- **Label:** Action labels use the frontmatter role.

**The Selective Emphasis Rule.** Highlight a meaningful phrase within a headline; preserve the surrounding sentence and reading order.

## Layout

The desktop container is capped at 1170px including 28px inline padding. Sections use the recorded section spacing; the hero has its own generous vertical spacing. Hero, feature, and scenario views pair explanatory copy with a readable product example rather than repeating marketing cards.

At 1050px, navigation and columns tighten. At 800px, paired layouts become single columns, gutters become 20px, and section spacing becomes 52px. Three feature choices remain a horizontal row; four scenario choices become a two-by-two grid. Mobile workflow order is title, step description, demonstration, controls, then note. Stage height is 380px on desktop and 365px on mobile. At 360px, the compact header uses a 112px logo, 16px gutters, and text-only language choices.

Keep mobile simulations readable within the viewport; do not replace them with tiny tilted device mockups. Preserve anchor navigation, Indonesian default, and the English toggle.

## Elevation & Depth

Marketing surfaces use tonal layering, separators, and rounded clipping rather than ambient card shadows. Device, toast, and ticket shadows are explicitly removed by landing overrides. Small chat-bubble shadows and profile-state outlines remain inside illustrative simulations and do not establish a marketing elevation scale.

**The Flat Surface Rule.** Product panels use color and borders to define their edges; do not add floating shadows to the landing shell.

## Shapes

Large product and feature panels use the panel radius; simulation screens and mobile menu containers use the stage radius. Buttons, language controls, tabs, and context chips use pill silhouettes. Circular initials stand in for guest portraits. Smaller field and bubble radii belong to the simulations rather than the landing shell.

## Components

The FAQ heading and 850px question list are centered within the page container;
questions and answers retain left alignment. The contact section, its supporting
copy, and its action group are centered on both desktop and mobile.

The comparison tabs include compact, static HTML illustrations with sample
data: separate chat and guest-book notes versus one connected guest history. Notes
use restrained rotation and flat borders; the connected profile uses existing navy.

### Buttons

Confident pill actions use logo-blue, white text, and the recorded padding. Primary controls have a 48px minimum height; compact navigation controls and playback buttons retain 44px targets. Hover changes the background over 0.2s. Contact actions on navy use a white primary button and a transparent outlined email button. The primary Indonesian CTA remains **Coba Intoch Sekarang**.

Every interactive component uses visible focus: a 3px blue outline with 5px offset. Quiet text links underline on hover.

### Cards / Containers

Guest history uses a navy panel with white text, muted supporting text, initials, dated rows, and subtle translucent separators. Feature examples use the soft surface with the same panel shape. Repeated sample-data labels were removed at the user’s request; example names, counts, and spending are not verified outcomes.

### Inputs / Fields

Fields are illustrative parts of workflow simulations, not live application forms. They use white surfaces, thin borders, compact rounded corners, and selected pills. Do not infer application input validation or authorization behavior from these examples.

### Navigation

The white sticky navigation has a divider and actual logo. Mobile uses a rounded menu and overlay, closes on link selection or Escape, and returns focus to its toggle when dismissed by Escape. Language choices use a bordered pill, with tint and blue marking the active language.

### Tabs and context chips

Feature choices use a pale track and white selected tab. Scenario choices on navy use outlined pills; the selected tab becomes white with navy text. Keyboard arrows, Home, and End change selection with a roving tab stop. Context chips use muted inverse text on a translucent navy-panel surface.

### Workflow demonstrations

Four scenarios retain three phases, each 2300ms, giving a 6.9-second loop. Pause and replay remain available; selecting a numbered step exposes a static manual state. Switching tabs while paused must show the new scenario's static phase. Playback suspends outside the visible section or hidden document. Reduced motion disables transitions and animation and offers manual phases; no-JavaScript mode exposes panel content and step descriptions.

Authored inline SVG supplies the corrected interface controls. Emoji inside sample chat messages remain conversational content. Source scan still carries birthday/history emoji and FAQ chevron glyphs; these are observed craft-floor drift, not approved icon-system tokens or patterns. They are not canonized by this document.

## Do's and Don'ts

### Do:
- **Do** preserve Intoch spelling, actual logo assets, and Plus Jakarta Sans.
- **Do** apply the Single Navy Rule and selective pale-blue emphasis.
- **Do** keep tab focus, mobile controls, pause/replay, and static states usable.
- **Do** retain the existing contact destinations and treat demo values as illustrative.

### Don't:
- **Don't** apply this landing system to the authenticated app without separate authorization.
- **Don't** replace the logo, add invented portraits or outcome claims, or generate decorative product screenshots.
- **Don't** add a lighter blue shell around navy sections or floating marketing-panel shadows.
- **Don't** use emoji or text glyphs as interface icons; sample conversational emoji remain allowed.
