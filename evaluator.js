/**
 * evaluator.js -- the math language behind mdcalc.
 *
 * The behavior spec lives in fixtures.json; the test suite asserts against
 * it, and the app itself re-runs it on every open.
 *
 * mdcalc documents are Markdown-ish: math lines compute, everything else is
 * prose. There is no list of Markdown syntax to skip -- MATH IS DEFINED BY
 * PARSING, so a heading, bullet, table row, or plain sentence is "prose"
 * simply because it fails the expression grammar. Two cases still surface
 * as "error" instead of going quiet, because they show clear intent to
 * compute: an assignment ("x = ..."), and a line that parsed as math but
 * failed numerically (1/0, sqrt(-1), overflow) -- see MathError.
 *
 * The whole document is re-evaluated top-to-bottom on every call: variables
 * and "_" are rebuilt from a clean environment each time, so an edit early
 * in the document ripples into every line below it and there is no stale
 * state to manage.
 *
 * WHY A HAND-WRITTEN PARSER instead of eval()/new Function()? Not only
 * safety -- JS operators disagree with this language's (conventional-math)
 * semantics, so eval() would compute several things *wrongly*:
 *
 *   //   is a line comment in JS, but floor division here
 *   %    is remainder in JS (-7 % 3 == -1), but modulo here (== 2)
 *   /    by zero yields Infinity in JS, but is an error here
 *   **   unary minus around it must bind the way written math reads
 *        (-2 ** 2 == -4), which JS syntax simply rejects
 *
 * The grammar is ordinary precedence climbing; each rule is commented with
 * the production it implements.
 */

export class EvalError_ extends Error {}

// Thrown only by operations on values that already parsed as math. That is
// the signal separating "definitely a broken calculation" (shown as error)
// from "probably prose" (shown as nothing) in evaluateDocument's catch.
export class MathError extends EvalError_ {}

/** Python's `//`: rounds toward negative infinity, unlike JS's truncation. */
const floorDiv = (a, b) => Math.floor(divide(a, b));

/** Python's `%`: result takes the divisor's sign, unlike JS's remainder. */
function modulo(a, b) {
  if (b === 0) throw new MathError("modulo by zero");
  return a - b * Math.floor(a / b);
}

/** Python raises on division by zero rather than yielding Infinity. */
function divide(a, b) {
  if (b === 0) throw new MathError("division by zero");
  return a / b;
}

/** Python's round(): ties go to the *even* neighbour, so round(2.5) == 2. */
function round(x, digits = 0) {
  const scale = 10 ** digits;
  const scaled = x * scale;
  const lower = Math.floor(scaled);
  const fraction = scaled - lower;
  if (fraction > 0.5) return (lower + 1) / scale;
  if (fraction < 0.5) return lower / scale;
  return (lower % 2 === 0 ? lower : lower + 1) / scale; // exact tie -> even
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new MathError("factorial needs a non-negative integer");
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

// The only names an expression can ever call. Looked up with Object.hasOwn so
// inherited members like "constructor" and "toString" stay unreachable.
const FUNCTIONS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  log: (x, base) => (base === undefined ? Math.log(x) : Math.log(x) / Math.log(base)),
  log2: Math.log2, log10: Math.log10, exp: Math.exp,
  floor: Math.floor, ceil: Math.ceil, factorial,
  abs: Math.abs, round, min: Math.min, max: Math.max,
};

const CONSTANTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

// "name = expr" but not "name == expr" (the lookahead rules out a second '=').
const ASSIGNMENT_RE = /^\s*([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/;

// Numbers, names, and the multi-character operators, longest alternative
// first so '**' never tokenizes as two '*' and '//' never as two '/'.
const TOKEN_RE = /\s*(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_]\w*|\*\*|\/\/|[+\-*/%(),])/y;

function tokenize(source) {
  // '#' starts a comment running to end of line -- which also makes every
  // Markdown heading a comment for free. This language has no string
  // literals, so cutting at the first '#' is exactly equivalent to lexing it.
  const text = source.split('#')[0];
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    TOKEN_RE.lastIndex = position;
    const match = TOKEN_RE.exec(text);
    if (!match) {
      if (text.slice(position).trim() === '') break; // only trailing spaces left
      throw new EvalError_(`unexpected character: ${text[position]}`);
    }
    tokens.push(match[1]);
    position = TOKEN_RE.lastIndex;
  }
  return tokens;
}

/**
 * Parse and evaluate one expression in a single pass. There is no separate
 * AST: nothing else needs the tree, so each rule returns a number directly.
 */
function evaluateExpression(source, env) {
  const tokens = tokenize(source);
  let position = 0;
  const eat = (token) => (tokens[position] === token ? (position += 1, true) : false);

  // additive := multiplicative (('+' | '-') multiplicative)*
  function additive() {
    let value = multiplicative();
    for (;;) {
      if (eat('+')) value += multiplicative();
      else if (eat('-')) value -= multiplicative();
      else return value;
    }
  }

  // multiplicative := unary (('*' | '/' | '//' | '%') unary)*
  function multiplicative() {
    let value = unary();
    for (;;) {
      if (eat('*')) value *= unary();
      else if (eat('//')) value = floorDiv(value, unary()); // before '/'
      else if (eat('/')) value = divide(value, unary());
      else if (eat('%')) value = modulo(value, unary());
      else return value;
    }
  }

  // unary := ('-' | '+') unary | power
  function unary() {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }

  // power := atom ('**' unary)?
  // Right-associative, and its right side may be signed. Recursing into
  // unary() (not power()) is what makes '2 ** -1' legal while leaving
  // '-2 ** 2' as -(2 ** 2) == -4, exactly as Python parses them.
  function power() {
    const base = atom();
    return eat('**') ? base ** unary() : base;
  }

  // atom := NUMBER | NAME | NAME '(' [expr (',' expr)*] ')' | '(' expr ')'
  function atom() {
    const token = tokens[position];
    position += 1;
    if (token === undefined) throw new EvalError_('unexpected end of expression');
    if (token === '(') {
      const value = additive();
      if (!eat(')')) throw new EvalError_('missing closing parenthesis');
      return value;
    }
    if (/^[\d.]/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) {
      if (eat('(')) {
        const args = [];
        if (!eat(')')) {
          do { args.push(additive()); } while (eat(','));
          if (!eat(')')) throw new EvalError_('missing closing parenthesis');
        }
        if (!Object.hasOwn(FUNCTIONS, token)) throw new EvalError_(`unknown function: ${token}`);
        return FUNCTIONS[token](...args);
      }
      if (Object.hasOwn(env, token)) return env[token];
      throw new EvalError_(`undefined name: ${token}`);
    }
    throw new EvalError_(`unexpected token: ${token}`);
  }

  const value = additive();
  if (position < tokens.length) throw new EvalError_('unexpected trailing input');
  return value;
}

/**
 * Render a number the way Python's str()/format(".6g") pair does: whole
 * numbers with no decimal point, everything else to 6 significant digits
 * with trailing zeros trimmed.
 */
export function formatNumber(value) {
  if (Number.isInteger(value)) return String(value); // String(-0) is "0", as in Python
  const precision = 6;
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const trim = (text) => (text.includes('.') ? text.replace(/\.?0+$/, '') : text);
  if (exponent < -4 || exponent >= precision) {
    // Exponential form. Python pads the exponent to at least two digits
    // ("1.234e-05"); JS toExponential does not ("1.234e-5"), so pad it.
    const [mantissa, exp] = value.toExponential(precision - 1).split('e');
    const sign = Number(exp) < 0 ? '-' : '+';
    return `${trim(mantissa)}e${sign}${String(Math.abs(Number(exp))).padStart(2, '0')}`;
  }
  return trim(value.toFixed(Math.max(0, precision - 1 - exponent)));
}

/**
 * Evaluate every line of `text` top to bottom against one shared
 * environment, returning one result string per line (same count as input
 * lines, so callers can zip them 1:1 for display).
 *
 *   "name = expr"    -> assigns env.name, result is its value; a broken
 *                       right-hand side is "error" (writing an assignment
 *                       is unambiguous intent to compute)
 *   a line that parses as math -> the value, also stored as "_" so the
 *                       next line can say "_" to mean "that answer"; if it
 *                       parsed but failed numerically (1/0, sqrt(-1),
 *                       overflow) it is "error"
 *   everything else  -> prose: no result. Blank lines, headings ("# ..."
 *                       is a comment), bullets, tables, sentences -- all
 *                       land here just by failing the grammar, which is
 *                       the entire Markdown-compatibility mechanism.
 *
 * Failed lines never touch the environment: no partial assignment, and
 * "_" still means the last *successful* result.
 */
export function evaluateDocument(text) {
  const env = { ...CONSTANTS };
  return text.split('\n').map((line) => {
    const stripped = line.trim();
    if (stripped === '') return '';
    const match = ASSIGNMENT_RE.exec(stripped);
    const target = match ? match[1] : null;
    const source = match ? match[2] : stripped;
    try {
      const value = evaluateExpression(source, env);
      // A result must be a finite real number: this turns JS's silent
      // NaN/Infinity (sqrt(-1), log(0), overflow) into visible errors.
      if (!Number.isFinite(value)) throw new MathError('result is not a finite number');
      if (target !== null) env[target] = value;
      env._ = value;
      return formatNumber(value);
    } catch (err) {
      // The prose/error split. Assignments and post-parse math failures
      // show "error"; anything else is treated as prose and stays quiet.
      return target !== null || err instanceof MathError ? 'error' : '';
    }
  });
}
