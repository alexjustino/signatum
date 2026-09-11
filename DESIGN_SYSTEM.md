# Design system

This is a contract, not advice. Every user-facing surface in Signatum obeys it, and a change
that diverges is corrected rather than merged.

The goal is narrow and demanding: Signatum should look like it belongs on Windows 11, not like
a web page inside a frame.

---

## 1. The one rule

> **A component never writes a raw value. If it is not a token, it does not exist.**

No hex colour, no pixel radius, no arbitrary duration, no one-off shadow in a component file.
The token layer is [`src/styles/tokens.css`](src/styles/tokens.css) and it is the only place a
value is decided.

If you need something the tokens do not offer, add it to the token layer with a reason —
do not approximate it locally. An approximation in one component is how a product stops looking
like one product.

## 2. Colour

Semantic values live under their own namespaces (`--surface-*`, `--fg-*`, `--stroke-*`,
`--accent-*`, `--state-*`) and are mapped into Tailwind's colour namespace by reference with
`@theme inline`. That indirection is what lets a theme change re-colour every utility at once
rather than freezing a literal into the compiled CSS.

**Light is the base definition on bare `:root`.** Nothing is defined _only_ inside a media
query — a token must always resolve. Dark is declared twice on purpose: once under
`prefers-color-scheme` for the system default, once under `[data-theme='dark']` so an explicit
choice wins in both directions.

### Surfaces, in the order Windows layers them

| Token      | What it is                                                 |
| ---------- | ---------------------------------------------------------- |
| `backdrop` | the Mica material — transparent, because Windows paints it |
| `layer`    | the content region floating on Mica                        |
| `card`     | an opaque element inside the layer                         |
| `flyout`   | Acrylic popovers and menus                                 |

An opaque `body` background would cover the Mica material and undo the entire effect. It stays
transparent.

### The accent colour is the user's, not ours

`src/app/theme.ts` reads the Windows accent **ramp** from the host and writes it into the token
layer. Windows exposes a ramp rather than a single colour because the shade that reads well on
white does not read well on near-black: light themes take the base and darker steps, dark
themes the lighter ones. Re-apply the ramp whenever the theme changes. In light, the fill and
text colour is the ramp's **first dark step**, not the raw accent — what Fluent does, and what keeps
accent text at 4.5:1 on white and on its own tint.

When the system cannot be asked, the built-in default is used and `fromSystem` is `false` —
and the interface says so. It does not pretend.

### Colour and the code

**The preview area is not themed.** Inside the frame, the code's foreground and background are
the **colours the person chose to print** — not surface tokens — and they render identically in
light and in dark. The theme colours the chrome around the code: the frame, the labels, the
controls, the scan-gate status. A code whose shade followed the application's theme would be a
preview of something that will never exist on paper.

So the contrast between those two colours is **a domain rule, not a token**. It is decided in
`domain/` against the threshold a camera needs, it is part of what the scan gate weighs, and it
is held by the rule tests — not by the token test, which has no business knowing what somebody
is about to print. Our palette is checked for a person reading a screen in two themes; the
code's palette is checked for a phone reading ink in a dim room. Two questions, two gates, and
neither answers for the other.

### A view says what it left out

A screen that cannot show every row does not quietly show the rest. A batch that made 198 files
out of 200 says which two rows it could not make, and why, in the same place it reports the
successes. An incomplete picture presented as a complete one is worse than an admission.

### A mark that is always on is not a mark

An indicator earns its place by distinguishing. A warning printed beside every code teaches
nothing and costs a glance — the density warning appears when the modules really are too small
at the chosen size, and not otherwise. Something that is always true is a label, not a warning,
and it is worded as one.

### An icon's own `title` is not a tooltip

A Fluent icon given `title` renders a `<title>` element inside its SVG: not a tooltip, not an
accessible name, and not findable as an attribute. An icon that carries meaning goes in a
wrapper with `role="img"`, `aria-label` and `title` — the same three things `IconButton`
requires — or it is decorative and `aria-hidden`. There is no third case.

### One word, one meaning

Before a state gets a word on a row, check the words already on that row. A code is _verified_,
_not verified yet_ or _refused_ — and refused always arrives with its reason. A logo is
_placed_, _resized to fit_ or _refused_; it is never _squeezed_, because the engine does not do
that. A glance that has to disambiguate is not a glance.

### A screen that removes everything keeps the way out

Anything that takes the chrome away earns it by making leaving the most obvious thing there:
a labelled button, Escape from anywhere, and the key named on the screen.

### A number can be opened

A figure on a screen is a button, and pressing it lists the rows it was added up from. A total
the reader cannot decompose is a claim; one they can is a fact they checked themselves.

### Two readings of one fact agree

When a surface shows the same fact twice — a status chip and the sentence under the preview, a
count and a list — the two must never contradict each other. When one reading is live, the
other defers to it.

### Severity is never colour alone

State (`info`, `success`, `caution`, `danger`) is carried by **colour and an icon and the
wording**. A red border alone is invisible to a large share of users. See `ui/InfoBar.tsx` for
the canonical shape.

## 3. Type

Segoe UI Variable with a declared fallback stack. The Fluent ramp:

`caption 12` → `body 14` (the product default) → `body-lg 16` → `subtitle 20` → `title 28` →
`display 40`

Payloads, colour values, measurements and punycode are set in the mono face: they are read
character by character, and a look-alike character has to be visible.

## 4. Space, radius, elevation

Spacing is the 4 px scale. Radius follows Windows 11 geometry: 8 px on the window, 4–6 px on
controls. Elevation has exactly four steps — `card`, `flyout`, `dialog`, `toast` — and a
component picks one rather than inventing a shadow.

**Density** is one attribute, two values: `comfortable` (default) and `compact`. Rows and
controls read `--density-row` and `--density-control`; they never hard-code a height. Changing
one attribute on `<html>` re-sizes the whole product.

## 5. Icons

**Fluent UI System Icons**, and only that set. Mixing icon families is immediately visible and
cannot be undone later without touching every screen.

- Sizes 16 / 20 / 24, matched to the control they sit in.
- `Filled` variants indicate an active or selected state; `Regular` otherwise.
- **An icon is never the only cue.** `IconButton` requires a `label`, which becomes both the
  accessible name and the tooltip. That requirement is in the type signature so it cannot be
  forgotten.

### The mark

**Not yet decided — and not invented here.** The product needs a mark in F0, because an
installer has to carry one, and it is finished in F11 with the rest of the Fluent polish. Until
then this section states what the mark has to satisfy, not what it looks like:

- **Monochrome-capable.** It must read as one colour before it reads as two: a taskbar, an
  installer, a black-and-white print of About and a disabled state will all take it that way.
- **Legible at 16 px.** Few shapes, no stroke thinner than the gap beside it, nothing that turns
  to grey mush in a tray.
- **It is not a finder pattern.** Concentric squares in the corner of a square invite a camera —
  and a person — to read the icon as a code. The mark of the product must never be mistaken for
  the thing the product makes, and must never be scannable by accident.
- **No "QR Code" wordmark.** _QR Code_ is a registered trademark of DENSO WAVE INCORPORATED. It
  is not in the name, it is not in the mark, and the notice stays in the README and in About.

Once it is decided, one file is the source and every raster the platform needs is generated from
it, never edited by hand:

```bash
node -e "require('sharp')('src-tauri/icons/signatum.svg').resize(1024,1024).png().toFile('src-tauri/icons/signatum-1024.png')"
npx tauri icon src-tauri/icons/signatum-1024.png --output src-tauri/icons
```

The same file is `src/assets/mark.svg`, shown beside the name in the title bar and on About, so
the window, the installer and the screen all carry one mark.

## 6. Motion

Fluent curves and durations, from the token layer: `--ease-easy`, `--ease-decelerate`,
`--ease-accelerate`; 100 / 150 / 200 / 300 ms. Motion connects states — a card that opens grows
from where it was — it does not decorate.

Loading shows a skeleton of the shape that is coming, not a spinner.

**`prefers-reduced-motion` is honoured globally**, in `global.css`, not per component. A
component cannot forget it. Nothing animates in a loop.

> A hard-won rule: check the **built** CSS, not just the source. A minifier that drops a
> prefix it does not understand can turn a conditional animation into an unconditional one from
> perfectly correct source.

## 7. Accessibility — WCAG 2.1 AA, without an asterisk

- Visible focus on every interactive element, in both themes. `:focus-visible` is styled
  globally; never remove an outline without replacing it.
- Full keyboard reach. **The keyboard reaches everything from the payload to the export** —
  typing the link, importing the logo, every style control, the scan-gate result and the button
  that writes the file, in that order, with no pointer at any step (F11).
- **Every screen has an `h1`**: one, first in the reading order, naming the screen in the same
  words the navigation used to get there.
- **Every scrolling region has an accessible name**, so a person who moves by region knows which
  list they are in before they start reading it.
- Contrast verified in both themes, including accent-on-surface. The code's own two colours are
  a separate, stricter gate — see §2, _Colour and the code_.
- Minimum target 32 px at comfortable density.
- Live regions for anything that changes without a click — through `announce()` from
  `ui/announce.ts`, rendered by the one `Announcer` mounted with the providers. A component
  never renders its own live region for a transient message. A verification that finishes is
  announced, with its outcome.
- Dialogs (`Modal`, `Drawer`, `ConfirmDialog`) hold Tab and give focus back on close, via
  `useFocusTrap`.

**Held by gates, not by review:** `src/styles/tokens.test.ts` checks every text-on-surface pair
in both themes; the end-to-end suite runs axe-core on every screen in both themes, where serious
and critical are failures, and drives the product by keyboard alone (`docs/SPEC.md` §6, slice
F11).

## 8. The canonical primitives

Everything lives in `src/ui/`. If a screen needs something that is not here, it is built here
first — not inline in the feature.

`Button` · `IconButton` · `SplitButton` · `Input` · `TextArea` · `SearchBox` · `Select` ·
`Combobox` · `DatePicker` · `TimePicker` · `Checkbox` · `Radio` · `Toggle` · `Slider` ·
`Badge` · `Chip` · `Avatar` · `Card` · `Modal` · `ConfirmDialog` · `Drawer` · `Flyout` ·
`Tooltip` · `Menu` · `ContextMenu` · `CommandBar` · `TabStrip` · `Breadcrumb` ·
`ProgressBar` · `ProgressRing` · `Skeleton` · `EmptyState` · `Toast` · `InfoBar` · `Kbd` ·
`Resizer` · `VirtualList`

Present today, because a screen uses them: `Button`, `Input`, `TextArea`, `Select`, `Checkbox`,
`Card`, `TabStrip`, `InfoBar` and `EmptyState`, beside this product's own `CodePreview` and
`ScanGateStatus`. Each of the rest arrives with the slice that first needs it, and arrives
_here_, never inline in a feature.

`TextArea` arrived with F2, for the fields that hold more than one line — a message, a body, plain
text. It is an `Input` that grew: both take their surface from `fieldSurface.ts`, so a single-line
and a multi-line field cannot drift into two different-looking controls, and it resizes vertically
only, because a field that can be dragged wider than its column breaks the layout it sits in.

`TabStrip` takes a `label`, and it is **required**: a strip with no accessible name is a row of
words to anybody who is not looking at it. On Create, the strip of payload kinds is named for the
question it answers — _"What the code does"_.

A shortcut shown beside the thing it triggers is a `Kbd`, everywhere, so a person learns to
read it once.

### What this product adds to the list

These are this product's own primitives. They are written **when their slice lands, and never
before** — a primitive built ahead of the screen that needs it is a guess with a type signature.

- **The code preview** (`CodePreview`, F0) — a figure around the rendered code, unthemed inside
  and themed around it (§2). Its accessible name states the **payload summary**, in the same
  words the preview shows: _"QR code that opens example.com"_, _"QR code that joins Office-5G"_,
  _"QR code that adds Ana Souza to contacts"_. Never named "preview", "image" or "QR code"
  alone: a name that does not say what scanning will do is not a name.
- **The scan-gate status** (`ScanGateStatus`, F0) — three states and no fourth: **verified**,
  **not verified**, **refused**, and refused always carries its reason in a sentence. It is
  **the export button's gate, not a decoration**: it owns that button's disabled state, it sits
  beside it, and it is announced when it changes. It never shows a state that did not come back
  from a decoder.
- **The physical-size input** (`PhysicalSizeInput`, F7) — a measurement with its unit,
  millimetres or inches, the unit inside the control rather than a label beside it, and the
  **module size read out** beneath it in the same unit. It takes the caution state when the
  modules fall under the readable threshold, and names the threshold when it does.
- **The logo plate picker** (`LogoPlatePicker`, F4) — the plate shape (none, square, rounded,
  circle) with its padding and its colour, as one control. Every option is reachable and named
  by keyboard, and the shape is never carried by the swatch alone.
- **The batch report table** (`BatchReportTable`, F9) — a summary that **opens onto its rows**:
  the figure is a button, pressing it lists the rows it counted, and a row that could not be
  made shows its line number and its reason. A batch total nobody can decompose is a claim.

### Asking "are you sure"

`ConfirmDialog`, always. It names what will happen, the confirming button repeats the verb, and
a destructive action takes the danger tone — with the wording carrying the consequence too,
never colour alone. `window.confirm` is not themed, not keyboard-consistent, and blocks the
window's own event loop; it does not appear in this codebase.

## 9. The window

The window is drawn without system decorations so Mica runs behind the chrome and the command
surface shares the title strip, the way modern Windows applications are built. The three window
controls are ours, including Fluent hover behaviour: close turns red, the others take the
neutral hover.

Drag regions are marked with `data-tauri-drag-region`; interactive children inside them opt out
automatically via `global.css`.

**Known gap, tracked rather than hidden.** Snap Layouts — hovering maximise to choose a layout
— requires native `WM_NCHITTEST` handling that a custom title bar does not get for free.
Maximising works; the hover flyout does not appear yet.

## 10. Degrade visibly, never silently

A native capability that is unavailable must be _seen_ to be unavailable.

- Mica unsupported → a solid token surface, and the application still looks deliberate.
- The accent ramp could not be read → the default is used and the interface reports it.
- **A code that did not pass the scan gate** → the export button is disabled **and a sentence
  beside it says why**: what the decoder read back instead, or which rule refused it. A disabled
  button with no reason is a defect report somebody else has to write.
- **A logo that cannot be used** → refused with a sentence naming the reason — larger than the
  error-correction budget allows, a file that is not the image it claims to be, an SVG carrying
  what an SVG must not carry — never a crash, never a hang, and never quietly swapped for
  something that fits.

Silence is the bug. A wrong colour with no explanation is worse than a plain one with a reason.

## 11. The gate

Every pull request that touches a user-facing surface is checked against this document, and:

- the screen was **opened in the real application**, in **both themes**, captured, and driven
  by keyboard;
- `npm run gates` is green — including ESLint, where `react-hooks/rules-of-hooks` is an error,
  because a hook after an early return type-checks cleanly and crashes the screen at runtime.

A green type-check is not evidence that a UI works.
