# Advanced Calculator — Neon UI

A responsive, attractive, browser-based scientific calculator with arbitrary-precision support (via Decimal.js), combinatorics helpers, advanced math functions, persistent history/memory/settings, autocomplete and keyboard navigation. The UI includes neon/backlight effects and is optimized to fit in small viewports.

Live demo: open `index.html` in your browser (requires internet for the Decimal.js CDN unless you bundle it locally).

---

## Table of contents

- Features
- Quick start
- Files
- Usage & examples
- Keyboard shortcuts
- Persistence (localStorage)
- Implementation notes
- Extending / development
- Troubleshooting
- License

---

## Features

- Arithmetic: `+`, `-`, `*`, `/`, `^`
- Parentheses and operator precedence
- Unary operators: unary minus, factorial `!`, percent `%`
- Functions: `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `ln`, `log` (base 10), `sqrt`, `root(a,n)`, `gamma`, `erf`, `abs`, `exp`, `nCr`, `nPr`
- Constants: `pi`, `e`, `ans` (previous answer)
- Memory: `MC`, `MR`, `M+`, `M-`
- History: clickable persistent history panel
- Autocomplete / function hints with keyboard navigation (arrow keys, Enter/Tab to accept)
- Smart function behavior:
  - After evaluation, clicking a unary function (e.g. `sqrt`) applies the function to the current result.
  - After evaluation, clicking a binary function (e.g. `root`) starts `root(currentValue,` so you can supply the second argument.
  - Postfix operators (`!`, `%`) applied after evaluation compute immediately.
- Arbitrary precision arithmetic via Decimal.js (configurable precision)
- BigInt-based combinatorics (exact `nCr`/`nPr` for integer arguments when enabled)
- Responsive layout — fits in narrow viewports; main grid scrolls if needed
- Attractive neon/backlit UI with subtle animations

---

## Quick start

1. Clone or download this repository and place files in one folder:
   - `index.html`
   - `styles.css`
   - `script.js`

2. Open `index.html` in a modern desktop or mobile browser.

3. (Optional) If you want to run fully offline, download Decimal.js and replace the CDN script tag with a local reference:
```html
<script src="path/to/decimal.min.js"></script>
```

---

## Files

- `index.html` — main HTML markup and UI skeleton.
- `styles.css` — all styles (responsive, neon UI, animations).
- `script.js` — tokenizer → shunting-yard → RPN evaluator; UI interactions, persistence, autocomplete.
- The project uses Decimal.js via CDN for arbitrary-precision math.

---

## Usage & examples

- Basic: type `8*2` then press Enter or click `=` → `16`.
- Apply function to last result: Evaluate `26`, then click `√` → computes `sqrt(26)`.
- Non-integer factorial: `4.5!` → uses gamma approximation (Lanczos).
- nth root: `root(27,3)` → `3`.
- Combinatorics:
  - `nCr(50,6)` → combination (exact if BigInt toggle enabled and operands are integer).
  - `nPr(10,3)` → permutations.
- Hyperbolic & inverse: `sinh(2)`, `asinh(1.5)`.
- Error cases:
  - Division by zero → "Math Error".
  - Unknown characters → "Invalid".
  - Syntax error → "Error".

Examples to try:
- `sqrt(26)` (apply after evaluating `26` by clicking `√`)
- `gamma(4.5)` or `4.5!`
- `nCr(50,6)` (enable BigInt toggle for exact integer combinatorics)
- `erf(1)`

---

## Keyboard shortcuts

- Digits/operators: type `0–9`, `+ - * / ^ ( ) .`
- Enter or `=`: evaluate expression
- Backspace: delete last character
- Escape: clear
- Type function names (e.g. `sqrt`) — autocomplete will show suggestions; accept with Enter or Tab
- Arrow Up / Arrow Down: navigate autocomplete suggestions
- After evaluation, typing a digit starts a new value (standard calculator behavior)

---

## Persistence (localStorage)

The calculator saves the following in localStorage so your data survives reloads:

- History: `calc_history_v3`
- Memory: `calc_memory_v3`
- Last answer: `calc_ans_v3`
- Angle mode (DEG/RAD): `calc_angle_v3`
- BigInt toggle: `calc_bigint_v3`
- Decimal precision: `calc_precision_v3`

To clear persistent data, either use the UI (history clear, memory clear) or clear the browser's localStorage for the page.

---

## Implementation notes

- Expression parsing:
  - Tokenizer converts numbers into Decimal instances.
  - Shunting-yard algorithm produces RPN (handles functions, commas, unary minus, postfix ops).
  - RPN evaluator executes using Decimal and BigInt (where applicable).
- Decimal.js:
  - Configurable precision (UI control). Default is 34 digits.
  - Decimal is used for most arithmetic; BigInt is used for exact integer combinatorics when enabled.
- Gamma / factorial:
  - Gamma implementation uses a Lanczos approximation (double precision).
  - For integer factorials within reasonable size, the app uses exact integer arithmetic (BigInt) or Decimal multiplicative approach.
- Autocomplete:
  - Presents function suggestions while typing; click to insert, or navigate with keyboard.
- UI:
  - Neon-inspired styles, glowing backlights on operator/equal buttons.
  - Responsive layout that fits into the viewport; button grid is scrollable on small heights.

---

## Extending / development

- Add more math functions:
  - For high-precision special functions (gamma, erf, etc.) consider integrating a numerical library with arbitrary precision (e.g. [big.js] or specialized libraries).
- Improve gamma/erf precision:
  - Current gamma/erf use double-precision approximations. Replace with arbitrary-precision algorithms if needed.
- Add themes:
  - The CSS uses custom properties; add a theme selector to update `--accent` variables.
- Build a single-file distributable:
  - Inline CSS & JS into `index.html`, and include Decimal.js as a bundled file.

Development:
- The parser has exported utilities (available through `window.__calc`) for debugging:
  - `window.__calc.evaluateExpression(expr)`
  - `window.__calc.tokenize(expr)`
  - `window.__calc.toRPN(tokens)`
  - `window.__calc.evaluateRPN(rpn)`

---

## Troubleshooting

- Results show "Invalid" — expression contains an unsupported character (non-ASCII operator or invisible character). Check your input for `×`, `÷`, non-breaking spaces, or copy-paste artifacts. The calculator normalizes common Unicode operators, but hidden characters may still cause validation errors. Open the browser console to inspect debugging logs if needed.
- Decimal.js not loaded — the app requires Decimal.js. Make sure the CDN script is reachable or include a local copy.
- Performance — large factorials or huge combinatorics may be computationally intensive and may block the browser. Use reasonable limits or add worker threads if you need very large computations.

---

## License

MIT — see LICENSE or include the text below.

---
