/**
 * app.js -- the browser UI for mdcalc.
 *
 * Deliberately thin: all the real logic is in evaluator.js. This file only
 * wires up five things -- recompute on edit, keep the results strip
 * scrolled with the text, load a file from disk, save one back, and run
 * the fixtures.json spec once on open (silent unless something fails).
 *
 * The results strip holds no state of its own. It is rewritten wholesale
 * from the evaluator's output on every change, which is what keeps it
 * from ever disagreeing with the text, and is why there is nothing here
 * worth unit-testing (the tests cover evaluator.js instead).
 */

import { evaluateDocument } from './evaluator.js';

const input = document.getElementById('input');
const results = document.getElementById('results');
const resultRows = document.getElementById('results-rows');
const filePicker = document.getElementById('file-picker');

// A browser page has no real notion of "the open file" -- the editor is the
// document. So there is no filename state at all; saves just download as:
const DOWNLOAD_NAME = 'mdcalc.md';

// The example doubles as a demo of the prose rule: the Markdown lines show
// nothing not because they are recognized, but because they don't parse.
const EXAMPLE = `# Welcome
This is a Markdown-ish notepad. Prose is ignored; math computes live.

## Monthly budget
- results appear in grey as you type
rent = 1200
food = 450
rent + food
_ * 12              # '_' means "the previous line's result"
`;

/**
 * Re-evaluate the document and redraw every result. Results are joined
 * with newlines into one pre-formatted block, so blank entries still
 * occupy a line and each result stays level with the line it came from.
 */
function refresh() {
  resultRows.textContent = evaluateDocument(input.value).join('\n');
  syncScroll();
}

/**
 * Keep the strip aligned with the text vertically, and clear of the
 * textarea's scrollbar horizontally. The scrollbar's width has to be
 * measured rather than assumed: it is 0 on platforms with overlay
 * scrollbars and non-zero elsewhere.
 */
function syncScroll() {
  resultRows.style.transform = `translateY(${-input.scrollTop}px)`;
  results.style.right = `${input.offsetWidth - input.clientWidth}px`;
}

function clearDocument() {
  // Clearing is not undoable, so confirm before discarding -- but only when
  // there is something to lose. Prompting on an already-empty editor would
  // be pure friction.
  if (input.value.trim() !== '' && !window.confirm('Discard the current document?')) return;
  input.value = '';
  refresh();
  input.focus();
}

/** Hand the current text back to the user's disk as a download. */
function saveDocument() {
  const blob = new Blob([input.value], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = DOWNLOAD_NAME;
  link.click();
  URL.revokeObjectURL(link.href);
}

filePicker.addEventListener('change', async () => {
  const file = filePicker.files[0];
  if (!file) return;
  input.value = await file.text();
  filePicker.value = ''; // reset, so picking the same file again still fires
  refresh();
  input.focus();
});

document.getElementById('clear-button').addEventListener('click', clearDocument);
document.getElementById('open-button').addEventListener('click', () => filePicker.click());
document.getElementById('save-button').addEventListener('click', saveDocument);

// Ctrl/Cmd+S saves, Ctrl/Cmd+O opens. Clear gets no shortcut on purpose:
// it is destructive, and the browser reserves the natural key (Ctrl/Cmd+N).
document.addEventListener('keydown', (event) => {
  if (!event.metaKey && !event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    saveDocument();
  } else if (key === 'o') {
    event.preventDefault();
    filePicker.click();
  }
});

input.addEventListener('input', refresh);
input.addEventListener('scroll', syncScroll);
window.addEventListener('resize', syncScroll);

/**
 * Run the shared spec against this build once per open. Pass is silent;
 * any mismatch gets an alert naming the failing cases, so a broken deploy
 * announces itself instead of quietly miscalculating someone's math.
 */
async function selfTest() {
  try {
    const { cases } = await (await fetch('fixtures.json')).json();
    const failed = cases.filter(
      (c) => evaluateDocument(c.document).join('\n') !== c.expected.join('\n'));
    if (failed.length > 0) {
      alert(`mdcalc self-test: ${failed.length} of ${cases.length} checks FAILED --\n`
        + `results may be wrong.\n\n${failed.map((c) => c.name).join('\n')}`);
    }
  } catch (err) {
    console.warn('mdcalc self-test could not run:', err); // fetch blocked (e.g. file://)
  }
}

input.value = EXAMPLE;
refresh();
input.focus();
selfTest(); // fire-and-forget: never delays first paint
