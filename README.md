# mdcalc

A Markdown-compatible live math notepad, in a single static page: write prose and
math together, and each math line's result appears in grey alongside it as
you type. No backend, no build step, no dependencies.

**Live at <https://joulesverne.github.io/mdcalc/>** — everything runs in
your browser; documents never leave your machine. The document persists
across reloads via `localStorage` (also local-only); the welcome example
appears only on a first visit, or when storage is unavailable.

## What computes, what doesn't

**The prose rule:** a line is math if it parses as math; every other line
is prose and shows nothing. There is no list of Markdown constructs in the
code — headings, bullets, blockquotes, tables, and plain sentences are
silent simply because they fail the expression grammar. So an ordinary
Markdown document passes through quietly, and the math sprinkled into it
computes.

- `name = expr` — assigns a variable, shown as its value
- any line that parses as an expression — shown as its value
- `_` — the previous successful result
- `# ...` — comment, whether a whole line (a Markdown heading) or trailing
- Operators: `+ - * / // % **` and parentheses
- Functions: `sqrt sin cos tan asin acos atan log log2 log10 exp floor ceil
  factorial abs round min max`
- Constants: `pi e tau`

`error` appears only where intent to compute is unambiguous: an assignment
whose right side is broken (`total = revenu * 2`), or a line that parsed as
math but failed numerically (`1 / 0`, `sqrt(-1)`, overflow). Failed lines
never disturb variables or `_`. One consequence worth knowing: a prose
sentence shaped like an assignment (`Budget = freedom`) reads as intended
math and shows `error`.

Semantics follow written-math conventions rather than JavaScript's: `//`
floors toward negative infinity (`-7 // 2` is `-4`), `%` takes the
divisor's sign (`-7 % 3` is `2`), `**` is right-associative and binds
tighter than unary minus (`-2 ** 2` is `-4`), `round()` breaks ties toward
even, and division by zero is an error rather than infinity. Numbers are
IEEE-754 doubles, so integers are exact only up to 2^53.

## Running

Serve the folder with any static file server, e.g.:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>. (A `file://` URL will not work: browsers
block ES-module loading and fetch over `file://`.)

**Open…** / **Save** (Ctrl/Cmd+O, Ctrl/Cmd+S) load a document from disk and
save one back — saves download as `mdcalc.md`. **Clear** empties the
editor, confirming first if there is anything to lose.

On touch screens the editor uses a 16px font (below that, iOS Safari
auto-zooms on focus and pushes the results strip off screen), and a
**Done** button appears in the header while editing — tapping it ends the
edit and dismisses the keyboard.

## Testing

The spec is [`fixtures.json`](fixtures.json): documents and their expected
per-line results. `npm test` runs it through Node's built-in test runner
(nothing to install), and a GitHub Actions workflow
([`.github/workflows/test.yml`](.github/workflows/test.yml)) runs the same
command on every push and pull request — so correctness is asserted at
commit time rather than by re-running the spec in every visitor's browser
at startup.

The UI layer is deliberately untested: it holds no state of its own, so
there is nothing there to get wrong that the evaluator tests don't cover.

## How it works

Results are never part of the editable text. They are drawn in a
non-interactive strip overlaid on the editor's right margin and rebuilt
wholesale from the evaluator's output on every keystroke — so what you edit
and what gets evaluated are only ever exactly what you typed. The editor
soft-wraps at the strip's edge, so text can never disappear underneath it;
since a wrapped line spans several visual rows, alignment is measured with
an invisible twin of the textarea (identical font, width, and wrapping)
whose per-line heights tell the strip how many blank rows to insert. Each
result sits level with the first row of its line.

- `index.html` — markup and layout
- `app.js` — UI wiring: recompute, scroll sync, file open/save, touch Done
- `evaluator.js` — the language: a hand-written parser (no `eval()`), which
  is what makes the non-JS semantics above exact rather than approximated
- `fixtures.json` — the behavior spec
- `test/evaluator.test.js` — runs the spec under `node --test`
