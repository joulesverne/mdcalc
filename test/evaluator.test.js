/**
 * Tests for the evaluator, using Node's built-in test runner so there is
 * nothing to install.
 *
 * The behavior cases live in ../fixtures.json -- the same spec the app
 * re-runs on every open (see selfTest in app.js). Add new language
 * behavior there, not here.
 *
 * Run with: npm test   (or: node --test)
 *
 * Scope: this covers the evaluator, which is all of the actual logic. The
 * DOM wiring in app.js is deliberately untested -- testing it would mean
 * pulling in a headless-browser dependency, and the whole point of the
 * overlay design is that the UI holds no state of its own to get wrong.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateDocument, formatNumber } from '../evaluator.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures.json', import.meta.url), 'utf8'));

for (const testCase of fixtures.cases) {
  test(testCase.name, () => {
    assert.deepEqual(evaluateDocument(testCase.document), testCase.expected);
  });
}

test('every document yields exactly one result per line', () => {
  // The UI zips results against lines 1:1 to position each result, so a
  // dropped or extra entry would silently misalign the whole gutter.
  for (const testCase of fixtures.cases) {
    const lines = testCase.document.split('\n');
    assert.equal(evaluateDocument(testCase.document).length, lines.length, testCase.name);
  }
});

test('formatNumber matches Python str()/%.6g formatting', () => {
  // Spot-checks of the formatter itself, including the exponential form that
  // no fixture document happens to reach.
  assert.equal(formatNumber(14), '14');
  assert.equal(formatNumber(-0), '0');
  assert.equal(formatNumber(2.5), '2.5');
  assert.equal(formatNumber(1 / 3), '0.333333');
  assert.equal(formatNumber(1.234e-5), '1.234e-05'); // two-digit exponent, as Python
  assert.equal(formatNumber(1234567.5), '1.23457e+06'); // large non-integer goes exponential
  assert.equal(formatNumber(1.5e20), '150000000000000000000'); // integer-valued: written out
  assert.equal(formatNumber(9.999999), '10'); // rounding carries into a new digit
});
