# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The Create screen.** Type a web link and it becomes a QR code on screen, redrawn as you
  type. Beside the code, one line says what scanning it will do — "Opens example.com" — with
  the host shown as it will actually resolve, so a look-alike domain is visible before it is
  printed. Only `http` and `https` are accepted as links.
- **Seven kinds of code, not one.** The Create screen asks what the code should do before it asks
  what it should say: a link, plain text, an e-mail, a phone number, a text message, a Wi-Fi
  network, or a place on a map. The kind is chosen at the top and the form below follows it. The
  line under the form says in one sentence what a phone will do with the code — "Opens
  example.com", "Joins Office-5G", "Calls (11) 91234-5678" — and the preview carries the same
  sentence as its name, so what is read aloud and what is printed are two readings of one fact.
- **Each kind is written in the form phones actually read.** An e-mail becomes a `mailto:` with
  the subject, the body **and** the name before the @ percent-encoded, so a `?` typed into a
  subject stays a character instead of becoming a second field that sends the message somewhere
  nobody saw. A phone number becomes `tel:` with the digits and at most a leading `+` — brackets,
  dots and dashes are what people write, not what a phone dials. A text message becomes
  `SMSTO:number:message`, the form both mobile platforms have read for a decade. A network becomes
  the `WIFI:` form, with `\`, `;`, `,`, `:` and `"` escaped in the name and in the password — the
  backslash first, so the escaping cannot itself be escaped — with no password field at all for an
  open network and the hidden flag only when the network is hidden. A place becomes `geo:` in
  decimal degrees, normalised, and a decimal comma is refused with a sentence rather than quietly
  becoming a different place. Plain text is the one kind with nothing to escape: it carries what
  was typed, byte for byte, line breaks and emoji included.
- **A draft for each kind, so looking costs nothing.** Trying the Wi-Fi form and going back to the
  link does not cost the link: every kind keeps its own half-finished form for as long as the
  window is open. A form that is not a code yet says which field is wrong and why, and that field
  is marked invalid for a screen reader as well as coloured for the eye — until something is
  typed, the line is a prompt rather than a telling-off.
- **The eighth kind: a contact card.** The list of kinds now ends with Contact, and a card is
  written in whichever of three forms the address book on the other side reads: **vCard 3.0** by
  default, because it is the form the widest range of phones, mail clients and address books
  import; **vCard 4.0**, the current version of the standard; and **MECARD**, which says the same
  things in roughly half the space, for a code that has to be printed small. Thirteen fields —
  name, organisation, title, two numbers, e-mail, website, a five-part address and a note — and
  the line under the form says what scanning does: "Adds Ana Souza to contacts". MECARD has
  nowhere to put a job title, so a card with one is still built and the screen says what was left
  out, rather than letting a person find that out from the phone that imported it.
- **Every field escaped, and long lines wrapped where the format wraps them.** In a card, `;` and
  `,` are what separate one field from the next, so a family name written `O'Brien; Jr` is escaped
  rather than filed as a name and a suffix — the backslash first, so the escaping cannot itself be
  escaped, and a line break in a note written the way the format writes one. A line longer than 75
  bytes is wrapped exactly as the standard prescribes, and never through the middle of an accented
  letter, so a card with a long address arrives as text rather than as mojibake. The
  website is written as the address it is: it is a web address, not a piece of text with
  separators in it, and escaping it would put a backslash into the link.
- **A number on a card carries its country code.** A card travels and is kept: a number without
  its country code is a local number on whatever phone reads it, months later and possibly in
  another country, so both number fields ask for the leading `+` and say so when it is missing.
  Numbers, e-mail addresses and websites on a card are read by the same rules the Phone, E-mail
  and Link kinds already use, so what one tab refuses the other refuses, in the same words.
- **A warning when the code would be printed too dense to scan.** A QR code does not fail
  gracefully at a small size — it either reads or it does not, and which one it is depends on a
  number nobody looks at: the size of one module. Beside the preview, the screen now says how
  small the modules would be at a nominal 25 mm and warns below half a millimetre, where most
  phone cameras stop resolving them at arm's length. It is a warning and never a refusal: the
  printed size is the person's to choose, and what decides whether a code may leave is still the
  decoder that reads it back. The size the sentence is about is the one chosen on the screen — see
  _the size is the size it will be printed at_, below.
- **The Wi-Fi password is carried in the clear, and the screen says so where it is typed.**
  Beneath the password field, in plain words: a saved code keeps this password in the clear on
  this machine. Choose an open network and the field is disabled, and says the code will not carry
  a password at all.
- **The scan gate, which is the product's whole claim.** Before a code can leave, the Rust host
  rasterises the exact drawing that is on screen, hands the pixels to a decoder that shares no
  code with the encoder that drew them, and compares what came back with what was asked for,
  byte for byte. The screen shows one of three states and no fourth: verified, not verified
  yet, or refused with the reason in a sentence.
- **Export to PNG, or no file at all.** The export writes the very bytes the decoder read —
  nothing is rendered a second time between the verdict and the file — through a temporary name
  renamed into place, so a half-written image never exists at the path somebody chose. A code
  that did not read back is refused, and the refusal leaves no file behind.
- **A record of every attempt, successful or not.** Each verification and each export writes a
  row to the workspace file: which decoder, at which version, read what, from which bytes, at
  what moment. Only hashes are kept — what a code carries is the person's business; whether a
  decoder read it back is the product's. A refusal is recorded as plainly as a success.
- **A logo in the middle of the code.** Choose an image and it is set in the centre of the
  code, over the modules themselves, and the code is then checked with it in place. A code with
  a logo is encoded at the strongest error correction the standard offers, so that what the logo
  covers is what the decoder can do without. In this slice the logo is a fixed fifth of the
  code's width, centred; deciding how large it may really be is the placement engine that
  follows.
- **Five kinds of image, and the file decides which.** PNG, JPEG, GIF, WebP and SVG. What a file
  is comes from its bytes and never from its name, so a PNG somebody called `logo.svg` is
  imported as the PNG it is, and the screen says that is what happened. An animated GIF gives its
  first frame, and says so. Nothing that arrives is kept as it arrived: a photograph is decoded,
  reduced to at most 1024 pixels on its longest side and written out again as a PNG this product
  made; an SVG is parsed into a drawing and written back out from that drawing. What is stored,
  shown, printed and exported is always that one clean copy.
- **A file that cannot be used says why, in one sentence, and leaves nothing behind.** Too large
  a file (over 20 MB), an image too big to be a brand mark (over 8192 pixels a side, or more than
  25 million pixels in total), an SVG over 1 MB or with more than 20,000 elements, an SVG that
  carries a script, an event handler or a reference to something outside itself, an empty file, a
  half-downloaded JPEG, an image that is entirely transparent, a name Windows will not give a
  file, a file on a network drive: each is refused with a sentence about that file, in well under
  a second, and nothing is written to the workspace.
- **The logo is part of what is proven, not a sticker on top of it.** The host draws the logo
  onto the pixels **before** the decoder is handed them, so the code that was read back is the
  code that carries the logo — and the file that is written is those same bytes. A logo that
  covered too much would make the code fail the gate and be refused like any other unreadable
  code, rather than reaching paper.
- **A plate under the logo.** None, square, rounded or circle — the shape the code clears behind
  the logo so the mark does not sit straight on the modules. It is drawn into the code itself, in
  the same pass as the modules, so what is checked is what is seen.
- **Logos you have used.** Imported logos stay in the workspace and are offered as a row of
  thumbnails, so the second code does not need the file again. Taking a logo out of a code
  deletes it, because a logo nobody is using is a file this product has no reason to keep.
- **The logo's size now comes from the code itself.** How much of a QR code a logo may cover is
  not a matter of taste: a code carries a fixed amount of error correction, and a logo spends it.
  The engine counts, before anything is drawn, exactly how many of the code's data pieces the
  logo would take from each block of error correction, and allows the largest centred square that
  stays inside that budget — with a deliberate margin left over, four tenths of what the code
  could correct, kept back for the things nobody controls: a smudged print, a bad angle, a cheap
  camera, a phone held at arm's length. The result is a logo smaller than a design tool would
  draw, and one the code can actually afford.
- **It never covers a part of the code that cannot be lost.** A QR code is not uniform. The three
  squares in its corners, the lines of alternating modules between them, the small squares that
  keep large codes from drifting, and the strip that says which error-correction level and mask
  the code uses are not data — a decoder needs them to find and read the code at all, and error
  correction does not cover them. The engine knows where every one of them sits, on all forty
  sizes of code, and the logo stops before it reaches one. The single exception is the small
  alignment square that some sizes of code place exactly in the middle, where a centred logo
  cannot avoid it; that one is allowed to go under the logo, because refusing it would push the
  code to a much larger size for the sake of the smallest pattern on it. It is written down as a
  decision still to be confirmed against real phone cameras, and it can be switched off.
- **The modules under the logo are cleared, whole ones only.** Rather than the image being laid
  over the pattern and the edges falling where they fall, the modules the logo covers are cleared
  out of the code first. No half module survives at the border of the plate to be read as a
  smudge, and no clipped module accidentally forms a shape that looks like part of the code.
- **The pattern is chosen again with the logo in place.** Every QR code is drawn through one of
  eight interchangeable patterns, and the encoder picks the one that gives the cleanest-looking
  code — large blank areas and misleading shapes are what make a code slow to scan. That choice
  is now made after the logo's modules have been cleared, on the code as it will really be
  printed, instead of on a code that no longer exists.
- **The level and the size of the code are chosen for the logo.** With a logo, the code is built
  at the strongest error correction the content allows, dropping one step only when the content
  will not otherwise fit, and never at the smallest size of code, which has no room to give.
- **A logo that will not fit is refused, and says why.** Not shrunk quietly until it does. The
  refusal names the cause in a sentence a person can act on: either it would reach a pattern the
  code cannot lose, or it is over the budget — by how many pieces, against how many that level
  can spare.
- **Smaller by choice, never larger.** The largest size the budget allows is what is offered, and
  a smaller logo can be asked for. There is no way to ask for a bigger one.
- **The code's two colours, and a gate that says when they will not do.** A code no longer has to
  be black on white: both colours can be chosen, and they are the colours of the print rather than
  of the application's theme — identical in a light window and a dark one, because paper has no
  theme. Before the code is built, the pair is measured the way accessibility measures text against
  its background, and a pair that is too close is refused with the contrast it reached and the 4.5
  a camera needs. A code lighter than the plate it sits on is refused as well, however strong the
  contrast: phone cameras look for a dark code on a light background, and several will not turn the
  picture over to find one. Both refusals arrive while the look is being chosen — a sentence about
  the colours, rather than a failed verification afterwards with nothing to point at.
- **Rounded modules, dots, and softened finders.** The little squares a code is made of can be
  drawn square, with softened corners, or as separate dots, and the three large squares in the
  corners can have their corners softened too — modestly, because the decoder that checks every
  code finds the grid by those corners, and a ring rounded further, or a circle, is a code it
  cannot read. What it cannot read is not offered. What does not change shape is the part a camera
  navigates by: the lines of alternating modules between the corners, the small alignment squares,
  the strip that records how the code was drawn. A scanner finds the grid by measuring those runs,
  and a row of dots is not a run — so they stay square whatever the rest of the code looks like.
  Every one of the nine combinations of module and corner shape is drawn, rasterised and read back
  by an independent decoder on every run of the test suite, and a code nobody restyled is drawn
  exactly as it was before, to the byte.
- **The blank margin around the code, and a warning where it stops working.** The standard asks for
  four modules of clear space on every side, which is what a code is given. Ask for less and the
  screen says that under four modules is where most scans fail; ask for none and it says a camera
  needs a blank margin to find the code at all. It is a warning and never a refusal — somebody who
  knows the page the code is going onto may have a reason — and what decides whether a code may
  leave is still the decoder that reads it back.
- **The size is the size it will be printed at.** A code is no longer a square of pixels: it is
  designed for a width on paper — millimetres or inches, from 5 mm to a metre — at a chosen
  resolution, and every number that follows comes from those two. The screen says how many pixels
  that is and how wide one module comes out on paper, so the density warning is now about the size
  the code is actually going to be printed at rather than an assumed 25 mm. A 25 mm code at 300 dpi
  is 295 pixels square, and it is 25 mm wide in every file that leaves.
- **Four ways out, and every one of them verified first.** A **PNG** with the resolution written
  into the file, so the file states its own physical size instead of leaving it to whatever opens it
  next. An **SVG** at the printed size, carrying the logo, for a layout tool — the same drawing the
  decoder read, with its width and height in millimetres and nothing else changed. A **PDF** whose
  page is exactly the size asked for, with the verified image on it edge to edge, which is the
  answer for a printer. And the **clipboard**, for the code that is going straight into a document.
  Nothing is rendered a second time between the verdict and the file: what a decoder read back is
  what is written, and where that could not be literally true — a vector file has no pixels to read
  — it is written down rather than glossed over.
- **The clipboard gets the picture, never the text.** Copy puts the verified image on the
  clipboard and never the payload behind it, because a payload on the clipboard is a paste into the
  wrong window — into the message somebody was writing, or into a terminal.
- **How much abuse the code can take, reported and never enforced.** After a code is verified, the
  same picture is shrunk to half, a third and a quarter of its size, blurred by one, two and three
  pixels, and squeezed through JPEG at three qualities — and each of the nine is handed back to the
  decoder. The screen says which of them still read. It is a report and never a gate: it does not
  block an export and does not change the verdict, because what the gate answers is _does this file
  read_ and what the margin answers is _how much is left before it does not_ — and a person
  printing on a menu, a bottle or a bus shelter is the one who knows which of the nine matters.
- **A library, so a code can be made again.** Codes are kept in the workspace and listed in their
  own place in the window: what each one is called, what kind it is, the one line that says what
  scanning it does, when it was saved, and a small drawing of the code itself — drawn again from
  what was saved, never a stored picture. Open one and everything comes back: the fields, the
  colours and shapes, the printed size and resolution, the logo and its plate.
- **Only a code that scanned can be saved.** Save appears beside the ways out and is available on
  the same terms they are: a code that has not been read back by the decoder is not saved, for the
  same reason it is not exported. What is kept is what was typed rather than what was encoded — so a
  correction to the way a format is escaped reaches every code already in the library — and the name
  of the drawing it made, which is how reopening it can prove it is the same code rather than assume
  it.
- **Reopened exactly, and proved again rather than trusted.** A saved code is rebuilt from its
  fields by the same rules that made it and checked against the drawing that was saved, then handed
  to the decoder again like a code typed from nothing. If a later version of the product would draw
  it differently, the screen says so instead of quietly showing something else under the old name.
- **Naming, renaming and deleting.** A code is named when it is saved — with a name suggested from
  what it carries, the web address, the person's name, the network — and can be renamed afterwards.
  Deleting one asks first, in a dialog that names what is about to go.
- **Brand kits: a look saved once and applied in one click.** A logo, the two colours, the shapes,
  the margin, the error-correction floor and the printed size can be saved together under a name and
  applied to any new code. A kit never carries a payload: applying one changes how a code looks and
  never what it says. A logo that a kit or a saved code is using cannot be deleted, and the refusal
  names the kits and the codes that are using it, so it is a sentence somebody can act on.
- **The choice about a Wi-Fi password is now a choice.** Saving a Wi-Fi code offers "Save the
  password with this code", ticked by default, with the plain sentence beside it: kept, the password
  is in the clear in the workspace file on this machine. Clear it and the code is saved without the
  password, and reopening it asks for the password again before the code can be checked or exported.
- **A list becomes codes: one verified file per row.** A CSV of links or of contact cards — chosen
  from disk, or pasted straight into the screen — is turned into one file per row, each one built by
  exactly the pipeline the Create screen uses and each one read back by the independent decoder
  before it is written. The first line of the file names the columns, and it decides what the batch
  is: a `url` column makes links, `given_name` and `family_name` make cards, and a file whose
  first line says neither is refused with the sentence that names what it needed. The look, the size
  and the logo are the ones on the Create screen, so a batch of two hundred cards looks like the one
  card that was designed.
- **Every row that could not be made is a line in a report, and never a stop.** A row with the wrong
  number of fields, an address that is not a link, a card with nobody's name on it, a logo that will
  not fit at that size: each is reported with its line number — the line as it is in the file, even
  when a note in a cell runs over several lines — and the rest of the list is made anyway. The plan
  is shown before a folder is chosen, so the count of what can and cannot be made is read before
  anything is written rather than after.
- **File names from a spreadsheet, made safe.** A `name` column names each file, or the code names
  itself when there is none. What arrives is reduced to one file name and nothing else: no path
  separator, no `..`, no control character, no name Windows reserves, at most eighty characters, and
  prefixed with the row's number so the folder sorts in the order of the file it came from and two
  people with the same name do not overwrite each other.
- **The folder chosen is the only place anything is written.** The folder is resolved once and every
  file is checked to be inside it before it is written; a row whose name is not a plain file name is
  reported as failed and never followed as a path. Each file is written through a temporary name
  renamed into place, so a half-written code never exists at a path somebody chose, and a file
  already in the folder under a row's name is never replaced — that row is reported instead.
- **The report is a CSV that cannot become a formula.** Every row and every problem, in line order,
  with the file's name, what happened to it and why — written beside the codes, never over a report
  that is already there. A cell beginning `=`, `+`, `-` or `@` is written as text, so a report about
  a hostile list is not itself the attack when it is opened in a spreadsheet. The cost is
  visible and deliberate: a name that is a negative number is written with a leading apostrophe.
- **It says where it is, and it can be stopped.** A counter moves as the rows are written — "137 of
  200" — and Cancel stops the run between rows: what was written stays written, and the rest is
  reported as skipped rather than quietly missing.
- **The application shell.** Six destinations — Create, Library, Batch, Diagnostics, Settings and
  About — in the Windows 11 visual language, following the accent colour chosen for the desktop, in
  light or dark by choice or by the system. The theme is remembered between sessions.
- **The workspace file.** One SQLite database created on first launch and migrated forward,
  never rewritten backwards; Diagnostics says where it is, how large it is and which schema
  version it holds.
- **The QR encoder, vendored rather than depended upon.** Project Nayuki's reference TypeScript
  generator lives in the repository, pinned by hash, with each local change recorded beside it —
  because later slices have to reach inside the matrix to place a logo without breaking it.
- **The matrix itself, proven against the standard rather than against the encoder.** The domain
  now carries the reading half of the QR standard as well as the writing half: the format and
  version information a symbol is required to carry, the table of alignment-pattern positions, and
  the finders, separators, timing patterns and dark module every code must draw. A code is checked
  against the published tables — the ones anybody can look up — instead of against whatever the
  encoder believed it had drawn.
- **Every version, every level, every mode, every mask.** All 3,840 combinations the standard
  allows — forty sizes, four levels of error correction, numeric, alphanumeric and byte content,
  eight mask patterns — are built and read back on every run of the test suite, beside known
  answers copied from the standard's own tables and a decode by a foreign decoder at every size
  and every level.
- **Ten thousand codes, read back by the decoder the product ships with.** A generated corpus of
  ten thousand randomised payloads — reaching every one of the forty sizes, from a single
  character to the largest a code can hold, text in several scripts, and one payload that is not
  text at all — is handed to the Rust decoder as pixels. Each has to come back as the same bytes
  and to report the same version, level and mask the encoder claimed. Bytes, because a payload
  that is not valid text would hide a defect if it were compared as text. The corpus is generated
  from a fixed seed, so a failure can be reproduced by its number, and it is never committed.
- **The corpus runs on demand and once a week, not on every change.** Ten thousand codes take
  minutes and need the host built in release, so they are asked for by name — `npm run corpus` —
  and by a workflow of their own, while the sweep of every version, level, mode and mask stays in
  the battery that runs on every push.
- **A test suite that drives the real product.** The end-to-end suite starts the built binary,
  types a link, exports a file, and decodes that file from disk with a _third_ decoder — one
  that shares its lineage with neither the encoder nor the host's. Three independent readings of
  one code.
- **The validation battery.** Version agreement, `cargo fmt`, Clippy, Rust tests, TypeScript,
  ESLint, Prettier and the unit suite, run by one command and by CI on every push — plus a
  dependency audit, an end-to-end workflow and a release workflow that refuses an oversized
  installer or one carrying source.
- Full specification: the thesis, the closed list for 1.0.0, the release train, the
  non-functional targets, the vertical slices with a proof of done each, and the risks — with
  the name decided and the collision evidence it was decided on.
- Binding architecture decisions: the layers, the boundary rule for `src/domain/`, the scan gate
  and the logo placement engine.
- The data model: the schema and its forward-only migration policy.
- The threat model: no network, hostile SVG and raster, escaping per payload format, links shown
  as they resolve, batch files confined to the chosen folder, and the hostile corpus the tests
  must refuse.
- The design system contract: Fluent on Windows 11, one token source, canonical primitives and
  the official icon set.
- Contributor documentation: branch model, Conventional Commits with this product's scopes, the
  architectural boundary, the security rule, the gates and the pull-request template.
- Apache-2.0 licence and a NOTICE carrying both trademark statements — the project's own, and
  DENSO WAVE's for "QR Code".

[Unreleased]: https://github.com/alexjustino/signatum/compare/main...HEAD
