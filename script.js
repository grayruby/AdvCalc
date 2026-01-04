// Advanced calculator engine (Decimal.js based) with improved function-button behavior and the neon UI.
// This is the same functional engine you were using previously: tokenizer, shunting-yard, RPN evaluator,
// persistence, autocomplete and the "apply function after evaluation" behavior for unary & binary functions.

// (Full engine — unchanged from previous iteration except minor safety comments)

(() => {
  if (typeof Decimal === 'undefined') throw new Error('Decimal.js is required. Make sure decimal.min.js is loaded before script.js');

  // --- DOM refs
  const displayEl = document.getElementById('display');
  const subdisplayEl = document.getElementById('subdisplay');
  const buttons = Array.from(document.querySelectorAll('.btn'));
  const historyEl = document.getElementById('history');
  const historyListEl = document.getElementById('historyList');
  const angleToggle = document.getElementById('angleToggle');
  const angleLabel = document.getElementById('angleLabel');
  const useBigIntToggle = document.getElementById('useBigInt');
  const precisionInput = document.getElementById('precisionInput');
  const autocompleteEl = document.getElementById('autocomplete');

  // --- LocalStorage keys
  const LS = {
    HISTORY: 'calc_history_v3',
    MEMORY: 'calc_memory_v3',
    ANGLE: 'calc_angle_v3',
    LAST_ANS: 'calc_ans_v3',
    USE_BIGINT: 'calc_bigint_v3',
    PRECISION: 'calc_precision_v3'
  };

  // --- State
  let input = '';
  let lastAnswer = new Decimal(0);
  let memory = new Decimal(0);
  let justEvaluated = false;
  let history = [];
  let errorTimeout = null;

  // autocomplete & function sets
  const FUNCTIONS = [
    'sin','cos','tan','asin','acos','atan',
    'sinh','cosh','tanh','asinh','acosh','atanh',
    'ln','log','sqrt','root','gamma','abs','exp','nCr','nPr','ans','erf'
  ];
  const UNARY_FUNCTIONS = new Set([
    'sin','cos','tan','asin','acos','atan',
    'sinh','cosh','tanh','asinh','acosh','atanh',
    'ln','log','sqrt','gamma','abs','exp','erf'
  ]);
  const BINARY_FUNCTIONS = new Set(['root','ncr','npr']);

  let acItems = [];
  let acIndex = -1;

  // --- Load persistent state
  (function loadPersist() {
    try { const h = localStorage.getItem(LS.HISTORY); if (h) history = JSON.parse(h); } catch {}
    try { const m = localStorage.getItem(LS.MEMORY); if (m) memory = new Decimal(m); } catch {}
    try { const a = localStorage.getItem(LS.LAST_ANS); if (a) lastAnswer = new Decimal(a); } catch {}
    try { const ang = localStorage.getItem(LS.ANGLE); if (ang) angleToggle.checked = (ang === 'deg'); } catch {}
    try { const bi = localStorage.getItem(LS.USE_BIGINT); if (bi) useBigIntToggle.checked = (bi === '1'); } catch {}
    try { const prec = localStorage.getItem(LS.PRECISION); if (prec) precisionInput.value = String(Number(prec)); } catch {}
  })();

  // --- Decimal precision
  function applyPrecision() {
    const p = Math.max(8, Math.min(200, Number(precisionInput.value) || 34));
    Decimal.set({ precision: p, toExpNeg: -9, toExpPos: 20 });
    localStorage.setItem(LS.PRECISION, String(p));
  }
  applyPrecision();

  function saveHistory() { try { localStorage.setItem(LS.HISTORY, JSON.stringify(history)); } catch {} }
  function saveMemory() { try { localStorage.setItem(LS.MEMORY, memory.toString()); } catch {} }
  function saveAns() { try { localStorage.setItem(LS.LAST_ANS, lastAnswer.toString()); } catch {} }
  function saveAngle() { try { localStorage.setItem(LS.ANGLE, angleToggle.checked ? 'deg' : 'rad'); } catch {} }
  function saveBigIntFlag() { try { localStorage.setItem(LS.USE_BIGINT, useBigIntToggle.checked ? '1' : '0'); } catch {} }

  // --- UI helpers
  function setDisplay(text) { displayEl.textContent = (text === '' || text === undefined) ? '0' : String(text); }
  function setSubdisplay(text) { subdisplayEl.textContent = text || ''; }
  function showError(msg = 'Error') {
    if (errorTimeout) clearTimeout(errorTimeout);
    displayEl.textContent = msg;
    displayEl.classList.add('error');
    setSubdisplay('');
    input = '';
    justEvaluated = true;
    errorTimeout = setTimeout(() => displayEl.classList.remove('error'), 1600);
  }
  function normalizeInput(s) {
    return s.replace(/\u00D7/g,'*').replace(/\u00F7/g,'/').replace(/\u2212/g,'-').replace(/×/g,'*').replace(/÷/g,'/');
  }
  function formatResult(x) {
    if (typeof x === 'bigint') return x.toString();
    if (x instanceof Decimal) {
      if (!x.isFinite()) return x.toString();
      if (x.abs().lt('1e-6')) return x.toExponential(10);
      if (x.isInteger() && x.abs().lt('1e21')) return Intl.NumberFormat().format(Number(x.toString()));
      return x.toSignificantDigits(12).toString();
    }
    return String(x);
  }

  // --- Tokenizer (numbers -> Decimal)
  function tokenize(expr) {
    const s = normalizeInput(expr).trim();
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '.' || /\d/.test(ch)) {
        let num = '';
        while (i < s.length && /[\d.]/.test(s[i])) num += s[i++];
        if (num.split('.').length > 2) throw new Error('Invalid number');
        tokens.push({ type:'number', value: new Decimal(num) });
        continue;
      }
      if (ch === ',') { tokens.push({ type:'comma' }); i++; continue; }
      if (/[a-zA-Z]/.test(ch)) {
        let name = '';
        while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) name += s[i++];
        const lname = name.toLowerCase();
        if (lname === 'pi' || lname === 'e' || lname === 'ans') tokens.push({ type:'const', value: lname });
        else tokens.push({ type:'func', value: lname });
        continue;
      }
      if ('+-*/^'.includes(ch)) { tokens.push({ type:'op', value: ch }); i++; continue; }
      if (ch === '(' || ch === ')') { tokens.push({ type:'paren', value: ch }); i++; continue; }
      if (ch === '%') { tokens.push({ type:'percent' }); i++; continue; }
      if (ch === '!') { tokens.push({ type:'fact' }); i++; continue; }
      throw new Error('Unknown token: ' + ch);
    }

    // unary minus detection
    const out = [];
    for (let j = 0; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === 'op' && t.value === '-') {
        if (j === 0 || (tokens[j-1].type === 'op') || (tokens[j-1].type === 'paren' && tokens[j-1].value === '(') || tokens[j-1].type === 'comma') {
          out.push({ type:'op', value:'u-' }); continue;
        }
      }
      out.push(t);
    }
    return out;
  }

  // --- Shunting-yard -> RPN
  function toRPN(tokens) {
    const out = [];
    const stack = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'number' || t.type === 'const') {
        out.push(t);
      } else if (t.type === 'func') {
        stack.push(Object.assign({}, t));
      } else if (t.type === 'comma') {
        while (stack.length && !(stack[stack.length-1].type === 'paren' && stack[stack.length-1].value === '(' && stack[stack.length-1]._isParenMarker)) {
          out.push(stack.pop());
        }
        if (!stack.length) throw new Error('Misplaced comma');
        stack[stack.length-1].argCount = (stack[stack.length-1].argCount || 0) + 1;
      } else if (t.type === 'op' || t.type === 'fact' || t.type === 'percent') {
        const op = (t.type === 'op') ? t.value : (t.type === 'fact' ? '!' : '%');
        const prec = { 'u-':5, '!':6, '%':6, '^':4, '*':3, '/':3, '+':2, '-':2 }[op] || 2;
        const rightAssoc = new Set(['^','u-']);
        while (stack.length) {
          const top = stack[stack.length-1];
          if (top.type === 'func') { out.push(stack.pop()); continue; }
          if (top.type === 'op' || top.type === 'fact' || top.type === 'percent') {
            const topOp = (top.type === 'op') ? top.value : (top.type === 'fact' ? '!' : '%');
            const topPrec = { 'u-':5, '!':6, '%':6, '^':4, '*':3, '/':3, '+':2, '-':2 }[topOp];
            if (rightAssoc.has(op) ? (prec < topPrec) : (prec <= topPrec)) { out.push(stack.pop()); continue; }
          }
          break;
        }
        const pushType = (op === '!') ? 'fact' : (op === '%' ? 'percent' : 'op');
        stack.push({ type: pushType, value: op });
      } else if (t.type === 'paren' && t.value === '(') {
        stack.push({ type:'paren', value:'(', _isParenMarker:true, argCount:0, hadArg:false });
      } else if (t.type === 'paren' && t.value === ')') {
        while (stack.length && !(stack[stack.length-1].type === 'paren' && stack[stack.length-1].value === '(' && stack[stack.length-1]._isParenMarker)) {
          out.push(stack.pop());
        }
        if (!stack.length) throw new Error('Mismatched parentheses');
        const parenMarker = stack.pop();
        const args = parenMarker.hadArg ? ((parenMarker.argCount || 0) + 1) : 0;
        if (stack.length && stack[stack.length-1].type === 'func') {
          const fn = stack.pop();
          fn.argCount = args || 1;
          out.push(fn);
        }
      } else {
        throw new Error('Unhandled token type: ' + JSON.stringify(t));
      }
    }
    while (stack.length) {
      const t = stack.pop();
      if (t.type === 'paren') throw new Error('Mismatched parentheses');
      out.push(t);
    }
    return out;
  }

  // --- Math helpers (gcd, gamma, erf, factorial)
  function gcdBigInt(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b !== 0n) { const r = a % b; a = b; b = r; }
    return a;
  }
  function nCrBigInt(n, r) {
    n = BigInt(n); r = BigInt(r);
    if (r < 0n || n < 0n || r > n) return 0n;
    let k = r; if (k > n - k) k = n - k;
    if (k === 0n) return 1n;
    let numer = []; for (let i = 0n; i < k; i++) numer.push(n - i);
    let denom = []; for (let i = 1n; i <= k; i++) denom.push(i);
    for (let i = 0; i < denom.length; i++) {
      let d = denom[i];
      if (d === 1n) continue;
      for (let j = 0; j < numer.length && d > 1n; j++) {
        const g = gcdBigInt(numer[j], d);
        if (g > 1n) { numer[j] /= g; d /= g; }
      }
      denom[i] = d;
    }
    let num = 1n; for (const x of numer) num *= x;
    let den = 1n; for (const x of denom) den *= x;
    return num / den;
  }
  function gammaNumber(z) {
    const g = 7;
    const p = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaNumber(1 - z));
    z -= 1;
    let x = p[0];
    for (let i = 1; i < p.length; i++) x += p[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  }
  function erfNumber(x) {
    const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741, a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
    const sign = x < 0 ? -1 : 1; const absx = Math.abs(x); const t = 1 / (1 + p * absx);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absx * absx);
    return sign * y;
  }
  function factorialGeneralDec(xDec) {
    if (xDec.isInteger() && xDec.gte(0)) {
      const n = xDec.toNumber();
      if (useBigIntToggle.checked && n <= 2000) {
        let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i;
        return r;
      }
      let res = new Decimal(1); for (let i = 2; i <= n; i++) res = res.times(i);
      return res;
    }
    return new Decimal(gammaNumber(xDec.plus(1).toNumber()));
  }

  // --- RPN evaluator
  function evaluateRPN(rpn) {
    const stack = [];
    const isDeg = angleToggle.checked;
    for (const token of rpn) {
      if (token.type === 'number') stack.push(token.value);
      else if (token.type === 'const') {
        if (token.value === 'pi') stack.push(new Decimal(Math.PI));
        else if (token.value === 'e') stack.push(new Decimal(Math.E));
        else if (token.value === 'ans') stack.push(lastAnswer);
        else throw new Error('Unknown constant: ' + token.value);
      } else if (token.type === 'op') {
        const op = token.value;
        if (op === 'u-') {
          const a = stack.pop(); if (a === undefined) throw new Error('Missing operand');
          if (typeof a === 'bigint') stack.push(-a); else stack.push(a.neg());
        } else {
          const b = stack.pop(); const a = stack.pop(); if (a === undefined || b === undefined) throw new Error('Missing operand for ' + op);
          if (typeof a === 'bigint' && typeof b === 'bigint') {
            switch (op) {
              case '+': stack.push(a + b); break;
              case '-': stack.push(a - b); break;
              case '*': stack.push(a * b); break;
              case '/': if (b === 0n) throw new Error('Division by zero'); stack.push(a / b); break;
              case '^': stack.push(a ** b); break;
              default: throw new Error('Unsupported bigint op ' + op);
            }
          } else {
            const A = (typeof a === 'bigint') ? new Decimal(a.toString()) : a;
            const B = (typeof b === 'bigint') ? new Decimal(b.toString()) : b;
            switch (op) {
              case '+': stack.push(A.plus(B)); break;
              case '-': stack.push(A.minus(B)); break;
              case '*': stack.push(A.times(B)); break;
              case '/': if (B.isZero()) throw new Error('Division by zero'); stack.push(A.div(B)); break;
              case '^': stack.push(Decimal.pow(A, B.toNumber())); break;
              default: throw new Error('Unknown operator ' + op);
            }
          }
        }
      } else if (token.type === 'fact') {
        const a = stack.pop(); if (a === undefined) throw new Error('Missing operand for !');
        if (typeof a === 'bigint') {
          let n = a; if (n < 0n) throw new Error('Negative factorial'); let r = 1n; for (let i = 2n; i <= n; i++) r *= i; stack.push(r);
        } else {
          const val = a;
          if (val.isInteger() && val.gte(0)) {
            const n = val.toNumber();
            if (useBigIntToggle.checked && n <= 2000) { let r = 1n; for (let i = 2n; i <= BigInt(n); i++) r *= i; stack.push(r); }
            else { let res = new Decimal(1); for (let i = 2; i <= n; i++) res = res.times(i); stack.push(res); }
          } else stack.push(new Decimal(gammaNumber(val.plus(1).toNumber())));
        }
      } else if (token.type === 'percent') {
        const a = stack.pop(); if (a === undefined) throw new Error('Missing operand for %');
        if (typeof a === 'bigint') stack.push(Number(a) / 100); else stack.push(a.div(100));
      } else if (token.type === 'func') {
        const fn = token.value;
        const argc = token.argCount || 1;
        const args = [];
        for (let k = 0; k < argc; k++) args.unshift(stack.pop());
        if (args.includes(undefined)) throw new Error('Missing argument(s) for ' + fn);
        try {
          let res;
          const a = args[0], b = args[1];
          const toRad = (x) => isDeg ? new Decimal(x.times(Math.PI).div(180)) : x;
          const fromRad = (x) => isDeg ? new Decimal(x.times(180).div(Math.PI)) : x;

          switch (fn) {
            case 'sin': res = new Decimal(Math.sin(toRad(new Decimal(a)).toNumber())); break;
            case 'cos': res = new Decimal(Math.cos(toRad(new Decimal(a)).toNumber())); break;
            case 'tan': res = new Decimal(Math.tan(toRad(new Decimal(a)).toNumber())); break;
            case 'asin': res = fromRad(new Decimal(Math.asin(Number(a)))); break;
            case 'acos': res = fromRad(new Decimal(Math.acos(Number(a)))); break;
            case 'atan': res = fromRad(new Decimal(Math.atan(Number(a)))); break;

            case 'sinh': res = new Decimal(Math.sinh ? Math.sinh(Number(a)) : (Math.exp(Number(a)) - Math.exp(-Number(a))) / 2); break;
            case 'cosh': res = new Decimal(Math.cosh ? Math.cosh(Number(a)) : (Math.exp(Number(a)) + Math.exp(-Number(a))) / 2); break;
            case 'tanh': res = new Decimal(Math.tanh ? Math.tanh(Number(a)) : ((Math.exp(Number(a)) - Math.exp(-Number(a))) / (Math.exp(Number(a)) + Math.exp(-Number(a))))); break;

            case 'asinh': res = new Decimal(Math.asinh ? Math.asinh(Number(a)) : Math.log(Number(a) + Math.sqrt(Number(a) * Number(a) + 1))); break;
            case 'acosh': res = new Decimal(Math.acosh ? Math.acosh(Number(a)) : Math.log(Number(a) + Math.sqrt(Number(a) - 1) * Math.sqrt(Number(a) + 1))); break;
            case 'atanh': res = new Decimal(Math.atanh ? Math.atanh(Number(a)) : 0.5 * Math.log((1 + Number(a)) / (1 - Number(a)))); break;

            case 'ln': res = new Decimal(Math.log(Number(a))); break;
            case 'log': res = new Decimal(Math.log10 ? Math.log10(Number(a)) : Math.log(Number(a)) / Math.LN10); break;
            case 'sqrt': res = new Decimal(Math.sqrt(Number(a))); break;

            case 'root':
              if (argc !== 2) throw new Error('root(a,n) requires 2 args');
              res = new Decimal(Math.pow(Number(a), 1 / Number(b)));
              break;

            case 'gamma':
              res = new Decimal(gammaNumber(Number(a)));
              break;

            case 'erf':
              res = new Decimal(erfNumber(Number(a)));
              break;

            case 'abs':
              if (typeof a === 'bigint') res = (a < 0n ? -a : a);
              else res = new Decimal(a).abs();
              break;

            case 'exp':
              res = new Decimal(Math.exp(Number(a)));
              break;

            case 'ncr': {
              if (argc !== 2) throw new Error('nCr requires 2 args');
              if (a.isInteger && b.isInteger && useBigIntToggle.checked) {
                const na = a.toNumber(), rb = b.toNumber();
                const big = nCrBigInt(na, rb);
                res = big;
              } else {
                const nnum = new Decimal(a), rnum = new Decimal(b);
                const nIsInt = nnum.isInteger(), rIsInt = rnum.isInteger();
                if (nIsInt && rIsInt) {
                  const nVal = nnum.toNumber(), rVal = rnum.toNumber();
                  if (rVal < 0 || nVal < 0 || rVal > nVal) res = new Decimal(0);
                  else {
                    const k = Math.min(rVal, nVal - rVal);
                    let resDec = new Decimal(1);
                    for (let i = 1; i <= k; i++) resDec = resDec.times(new Decimal(nVal - k + i)).div(new Decimal(i));
                    res = resDec;
                  }
                } else {
                  res = new Decimal(gammaNumber(nnum.plus(1).toNumber())).div(new Decimal(gammaNumber(rnum.plus(1).toNumber())).times(new Decimal(gammaNumber(nnum.minus(rnum).plus(1).toNumber()))));
                }
              }
              break;
            }
            case 'npr': {
              if (argc !== 2) throw new Error('nPr requires 2 args');
              if (a.isInteger && b.isInteger && useBigIntToggle.checked) {
                const na = BigInt(a.toNumber()), rb = BigInt(b.toNumber());
                if (rb > na) res = 0n;
                else {
                  let r = 1n; for (let i = 0n; i < rb; i++) r *= (na - i);
                  res = r;
                }
              } else {
                const nnum = new Decimal(a), rnum = new Decimal(b);
                if (!rnum.isInteger() || !nnum.isInteger()) {
                  res = new Decimal(gammaNumber(Number(nnum.plus(1)))).div(new Decimal(gammaNumber(Number(nnum.minus(rnum).plus(1)))));
                } else {
                  const nVal = nnum.toNumber(), rVal = rnum.toNumber();
                  if (rVal > nVal) res = new Decimal(0);
                  else {
                    let r = new Decimal(1);
                    for (let i = 0; i < rVal; i++) r = r.times(new Decimal(nVal - i));
                    res = r;
                  }
                }
              }
              break;
            }
            default:
              throw new Error('Unknown function ' + fn);
          }
          stack.push(res);
        } catch (err) { throw err; }
      } else {
        throw new Error('Unhandled token: ' + JSON.stringify(token));
      }
      if (stack.length > 5000) throw new Error('Stack overflow');
    }
    if (stack.length !== 1) throw new Error('Invalid expression');
    const final = stack[0];
    if (typeof final === 'bigint') return final;
    if (final instanceof Decimal && !final.isFinite()) throw new Error('Math Error');
    return final;
  }

  // --- Evaluate wrapper
  function evaluateExpression(expr) {
    if (!expr || !expr.trim()) return;
    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    const result = evaluateRPN(rpn);
    if (typeof result === 'bigint') lastAnswer = new Decimal(result.toString());
    else lastAnswer = new Decimal(result);
    pushHistory(expr, result);
    saveAns();
    return result;
  }

  // --- History
  function pushHistory(expr, result) {
    const item = { expr, result: (typeof result === 'bigint') ? result.toString() : (result instanceof Decimal ? result.toString() : String(result)) };
    history.unshift(item);
    if (history.length > 300) history.pop();
    renderHistory();
    saveHistory();
  }
  function renderHistory() {
    historyListEl.innerHTML = '';
    history.forEach(h => {
      const li = document.createElement('li');
      li.title = h.expr + ' = ' + h.result;
      const left = document.createElement('span'); left.className = 'expr'; left.textContent = h.expr;
      const right = document.createElement('span'); right.className = 'res'; right.textContent = h.result;
      li.appendChild(left); li.appendChild(right);
      li.addEventListener('click', () => {
        input = h.expr;
        setDisplay(input);
        setSubdisplay(h.result.toString());
      });
      historyListEl.appendChild(li);
    });
  }

  // --- Autocomplete helpers
  function openAutocomplete(prefix) {
    const p = prefix.toLowerCase();
    acItems = FUNCTIONS.filter(fn => fn.startsWith(p));
    if (!acItems.length) { closeAutocomplete(); return; }
    autocompleteEl.innerHTML = '';
    acItems.forEach((fn, idx) => {
      const div = document.createElement('div');
      div.className = 'item' + (idx === 0 ? ' selected' : '');
      div.textContent = fn + (fn === 'root' ? '(a,n)' : (fn === 'nCr' || fn === 'nPr' ? '(n,r)' : '()'));
      div.dataset.fn = fn;
      div.addEventListener('click', () => insertFunction(fn));
      autocompleteEl.appendChild(div);
    });
    acIndex = 0;
    autocompleteEl.classList.add('open');
  }
  function closeAutocomplete() { autocompleteEl.classList.remove('open'); acItems = []; acIndex = -1; }
  function highlightAutocomplete(idx) {
    const nodes = autocompleteEl.querySelectorAll('.item'); nodes.forEach(n => n.classList.remove('selected'));
    if (idx >= 0 && idx < nodes.length) nodes[idx].classList.add('selected');
  }
  function insertFunction(fn) { input += fn + '('; setDisplay(input); closeAutocomplete(); }

  // --- Button handlers (smart function behavior after evaluation)
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-value');
      const action = btn.getAttribute('data-action');

      if (action === 'clear') return doClear();
      if (action === 'backspace') return doBackspace();
      if (action === 'equals') return doEquals();
      if (action === 'history-toggle') return toggleHistory();
      if (action === 'ans') return doAns();
      if (action === 'mc') return doMemoryClear();
      if (action === 'mr') return doMemoryRecall();
      if (action === 'mplus') return doMemoryAdd();
      if (action === 'mminus') return doMemorySub();
      if (action === 'clear-history') return doClearHistory();

      if (val) {
        // If the button is a function (data-value ending with '('), handle smart behavior after evaluation.
        if (val.endsWith('(')) {
          const fnName = val.slice(0, -1).toLowerCase();

          if (justEvaluated) {
            // Unary function -> apply immediately: fn(lastResult)
            if (UNARY_FUNCTIONS.has(fnName)) {
              try {
                const expr = fnName + '(' + input + ')';
                const res = evaluateExpression(expr);
                // display result
                setDisplay(typeof res === 'bigint' ? res.toString() : formatResult(res instanceof Decimal ? res : new Decimal(res)));
                setSubdisplay(expr + ' =');
                input = typeof res === 'bigint' ? res.toString() : (new Decimal(res)).toString();
                justEvaluated = true;
              } catch (e) {
                console.error(e);
                showError(e.message || 'Error');
              }
              return;
            }

            // Binary function -> start call with current result as first arg
            if (BINARY_FUNCTIONS.has(fnName)) {
              input = fnName + '(' + input + ',';
              justEvaluated = false;
              setDisplay(input);
              return;
            }
          }

          // default: insert function text for building a new expression
          if (justEvaluated) {
            input = val;
            justEvaluated = false;
            setDisplay(input);
            return;
          } else {
            input += val;
            setDisplay(input);
            const m = input.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
            if (m) openAutocomplete(m[0]); else closeAutocomplete();
            return;
          }
        }

        // Postfix unary operators: if justEvaluated and val is '!' or '%', apply immediately
        if ((val === '!' || val === '%') && justEvaluated) {
          input = input + val;
          return doEquals();
        }

        // Default digit/operator insertion
        if (justEvaluated && /^[0-9.]/.test(val)) {
          input = val;
        } else {
          input += val;
        }
        justEvaluated = false;
        setDisplay(input);
        const m = input.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
        if (m) openAutocomplete(m[0]); else closeAutocomplete();
      }
    });
  });

  // --- Settings handlers
  angleToggle.addEventListener('change', () => { angleLabel.textContent = angleToggle.checked ? 'DEG' : 'RAD'; saveAngle(); });
  useBigIntToggle.addEventListener('change', saveBigIntFlag);
  precisionInput.addEventListener('change', () => { applyPrecision(); });

  // --- Memory operations
  function doMemoryClear() { memory = new Decimal(0); saveMemory(); flashSub('MC'); }
  function doMemoryRecall() { input += memory.toString(); setDisplay(input); }
  function doMemoryAdd() {
    try { const v = new Decimal(displayEl.textContent.replace(/,/g,'')); if (!v.isFinite()) throw new Error(); memory = memory.plus(v); saveMemory(); flashSub('M+'); } catch { showError('No value'); }
  }
  function doMemorySub() {
    try { const v = new Decimal(displayEl.textContent.replace(/,/g,'')); if (!v.isFinite()) throw new Error(); memory = memory.minus(v); saveMemory(); flashSub('M-'); } catch { showError('No value'); }
  }
  function flashSub(t) { setSubdisplay(t); setTimeout(() => setSubdisplay(''), 800); }

  // --- History and actions
  function toggleHistory() { historyEl.classList.toggle('open'); }
  function doClearHistory() { history = []; renderHistory(); saveHistory(); }

  function doClear() { input = ''; setDisplay(''); setSubdisplay(''); justEvaluated = false; closeAutocomplete(); }
  function doBackspace() {
    if (justEvaluated) { input = ''; justEvaluated = false; setDisplay(''); return; }
    input = input.slice(0, -1);
    setDisplay(input);
    const m = input.match(/[a-zA-Z_][a-zA-Z0-9_]*$/);
    if (m) openAutocomplete(m[0]); else closeAutocomplete();
  }
  function doEquals() {
    if (!input.trim()) return;
    try {
      const res = evaluateExpression(input);
      setDisplay(typeof res === 'bigint' ? res.toString() : formatResult(res instanceof Decimal ? res : new Decimal(res)));
      setSubdisplay(input + ' =');
      input = typeof res === 'bigint' ? res.toString() : (new Decimal(res)).toString();
      justEvaluated = true;
      saveHistory();
    } catch (e) {
      console.error(e);
      showError(e.message || 'Error');
    }
  }
  function doAns() { input += 'ans'; setDisplay(input); }

  // --- Keyboard support + autocomplete navigation
  window.addEventListener('keydown', (e) => {
    if (e.key >= '0' && e.key <= '9') { input += e.key; setDisplay(input); e.preventDefault(); return; }
    if (['+', '-', '*', '/', '^', '(', ')', '.', '%', '!'].includes(e.key)) { input += e.key; setDisplay(input); e.preventDefault(); return; }
    if (e.key === 'Enter' || e.key === '=') { doEquals(); e.preventDefault(); return; }
    if (e.key === 'Backspace') { doBackspace(); e.preventDefault(); return; }
    if (e.key === 'Escape') { doClear(); closeAutocomplete(); e.preventDefault(); return; }
    if (/^[a-zA-Z]$/.test(e.key)) {
      input += e.key; setDisplay(input); const m = input.match(/[a-zA-Z_][a-zA-Z0-9_]*$/); if (m) openAutocomplete(m[0]); e.preventDefault(); return;
    }
    if (autocompleteEl.classList.contains('open')) {
      if (e.key === 'ArrowDown') { acIndex = Math.min(acIndex + 1, acItems.length - 1); highlightAutocomplete(acIndex); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { acIndex = Math.max(acIndex - 1, 0); highlightAutocomplete(acIndex); e.preventDefault(); return; }
      if (e.key === 'Enter') { if (acIndex >= 0) insertFunction(acItems[acIndex]); e.preventDefault(); return; }
      if (e.key === 'Tab') { if (acIndex >= 0) insertFunction(acItems[acIndex]); e.preventDefault(); return; }
    }
  });

  document.addEventListener('click', (ev) => { if (!autocompleteEl.contains(ev.target)) closeAutocomplete(); });

  // --- Init UI
  setDisplay('');
  renderHistory();
  angleLabel.textContent = angleToggle.checked ? 'DEG' : 'RAD';

  window.__calc = { evaluateExpression, tokenize, toRPN, evaluateRPN, getHistory: () => history.slice(), getMemory: () => memory.toString() };

  window.addEventListener('beforeunload', () => { saveHistory(); saveMemory(); saveAngle(); saveAns(); saveBigIntFlag(); applyPrecision(); });
})();