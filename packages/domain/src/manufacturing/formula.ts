/**
 * Sandboxed arithmetic-formula evaluator for configurable products
 * (docs/archive/catalog/07 §المنتجات القابلة للتهيئة — material/price/labour/overhead
 * formulas such as `2*width`, `2*(width+height)/100`, `width*height*rate`).
 *
 * SECURITY INVARIANT: this evaluator NEVER uses `eval`, `Function`, `with`, or
 * any dynamic code execution. A formula string is tokenised, parsed into an AST
 * by a hand-written recursive-descent parser, and walked by an interpreter that
 * only knows numbers, the four arithmetic operators, parentheses, a fixed
 * whitelist of pure math functions, and the variables the caller supplies. There
 * is no property access, no identifier resolution against any host object, and
 * no way to reach global scope — an untrusted formula can only ever compute a
 * number from its declared inputs.
 *
 * EXACTNESS: to honour the "no floats, ever" rule (docs/archive/plan.md §2.3) every
 * intermediate value is an exact rational (bigint numerator / bigint
 * denominator). Division stays exact; the single rounding step happens only when
 * the final rational is projected onto the canonical scale-1e6 integer used by
 * Money/Qty (HALF_UP on the magnitude), so results are byte-identical on every
 * platform.
 */

import { Money, Qty } from "../money/index.js";
import { FormulaError } from "./errors.js";

const SCALE = 1_000_000n; // 1e6 — Money/Qty canonical scale.

/** An exact rational held as bigints; the denominator is always positive. */
interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x === 0n ? 1n : x;
}

function rational(n: bigint, d: bigint): Rational {
  if (d === 0n) throw new FormulaError("EVAL", "division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

const R_ZERO: Rational = { n: 0n, d: 1n };

function rAdd(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d + b.n * a.d, a.d * b.d);
}
function rSub(a: Rational, b: Rational): Rational {
  return rational(a.n * b.d - b.n * a.d, a.d * b.d);
}
function rMul(a: Rational, b: Rational): Rational {
  return rational(a.n * b.n, a.d * b.d);
}
function rDiv(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new FormulaError("EVAL", "division by zero");
  return rational(a.n * b.d, a.d * b.n);
}
function rCompare(a: Rational, b: Rational): number {
  const lhs = a.n * b.d;
  const rhs = b.n * a.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

/** Project a rational onto scale-1e6, rounding HALF_UP on the magnitude. */
function toScaled(r: Rational): bigint {
  const negative = r.n < 0n;
  const n = negative ? -r.n : r.n;
  const num = n * SCALE;
  const q = num / r.d;
  const rem = num % r.d;
  const rounded = rem * 2n >= r.d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Round a rational to `decimals` fractional places (HALF_UP), returning a rational. */
function roundRational(r: Rational, decimals: number): Rational {
  let pow = 1n;
  for (let i = 0; i < decimals; i++) pow *= 10n;
  const negative = r.n < 0n;
  const n = negative ? -r.n : r.n;
  const num = n * pow;
  const q = num / r.d;
  const rem = num % r.d;
  const roundedAbs = rem * 2n >= r.d ? q + 1n : q;
  const signed = negative ? -roundedAbs : roundedAbs;
  return rational(signed, pow);
}

// --- Tokeniser -------------------------------------------------------------

type TokenType = "num" | "ident" | "op" | "lparen" | "rparen" | "comma";
interface Token {
  readonly type: TokenType;
  readonly value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= "0" && c <= "9";
  const isIdentStart = (c: string) => /[A-Za-z_؀-ۿ]/.test(c);
  const isIdentPart = (c: string) => /[A-Za-z0-9_؀-ۿ]/.test(c);

  while (i < input.length) {
    const c = input[i] as string;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(input[i + 1] ?? ""))) {
      let j = i + 1;
      let seenDot = c === ".";
      while (j < input.length) {
        const d = input[j] as string;
        if (isDigit(d)) {
          j++;
        } else if (d === "." && !seenDot) {
          seenDot = true;
          j++;
        } else {
          break;
        }
      }
      tokens.push({ type: "num", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < input.length && isIdentPart(input[j] as string)) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ type: "lparen", value: c });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ type: "rparen", value: c });
      i++;
      continue;
    }
    if (c === ",") {
      tokens.push({ type: "comma", value: c });
      i++;
      continue;
    }
    throw new FormulaError("PARSE", `unexpected character "${c}"`);
  }
  return tokens;
}

// --- AST -------------------------------------------------------------------

type Node =
  | { readonly kind: "num"; readonly value: Rational }
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "neg"; readonly operand: Node }
  | { readonly kind: "bin"; readonly op: "+" | "-" | "*" | "/"; readonly lhs: Node; readonly rhs: Node }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly Node[] };

/** The only functions a formula may call — all pure, all deterministic. */
const FUNCTIONS = new Set(["min", "max", "abs", "floor", "ceil", "round"]);

function parseDecimal(literal: string): Rational {
  const dot = literal.indexOf(".");
  if (dot < 0) return rational(BigInt(literal), 1n);
  const intPart = literal.slice(0, dot) || "0";
  const fracPart = literal.slice(dot + 1);
  if (fracPart === "") return rational(BigInt(intPart), 1n);
  let denom = 1n;
  for (let k = 0; k < fracPart.length; k++) denom *= 10n;
  return rational(BigInt(intPart + fracPart), denom);
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    if (this.tokens.length === 0) throw new FormulaError("PARSE", "empty formula");
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new FormulaError("PARSE", `unexpected token "${this.peek()?.value ?? ""}"`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new FormulaError("PARSE", "unexpected end of formula");
    this.pos++;
    return t;
  }

  // expr := term (("+" | "-") term)*
  private parseExpr(): Node {
    let left = this.parseTerm();
    while (this.peek()?.type === "op" && (this.peek()!.value === "+" || this.peek()!.value === "-")) {
      const op = this.next().value as "+" | "-";
      const right = this.parseTerm();
      left = { kind: "bin", op, lhs: left, rhs: right };
    }
    return left;
  }

  // term := factor (("*" | "/") factor)*
  private parseTerm(): Node {
    let left = this.parseFactor();
    while (this.peek()?.type === "op" && (this.peek()!.value === "*" || this.peek()!.value === "/")) {
      const op = this.next().value as "*" | "/";
      const right = this.parseFactor();
      left = { kind: "bin", op, lhs: left, rhs: right };
    }
    return left;
  }

  // factor := ("+" | "-") factor | primary
  private parseFactor(): Node {
    const t = this.peek();
    if (t?.type === "op" && (t.value === "+" || t.value === "-")) {
      this.next();
      const operand = this.parseFactor();
      return t.value === "-" ? { kind: "neg", operand } : operand;
    }
    return this.parsePrimary();
  }

  // primary := num | ident | ident "(" args ")" | "(" expr ")"
  private parsePrimary(): Node {
    const t = this.next();
    if (t.type === "num") return { kind: "num", value: parseDecimal(t.value) };
    if (t.type === "lparen") {
      const node = this.parseExpr();
      const close = this.next();
      if (close.type !== "rparen") throw new FormulaError("PARSE", "expected )");
      return node;
    }
    if (t.type === "ident") {
      if (this.peek()?.type === "lparen") {
        this.next(); // consume (
        const args: Node[] = [];
        if (this.peek()?.type !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek()?.type === "comma") {
            this.next();
            args.push(this.parseExpr());
          }
        }
        const close = this.next();
        if (close.type !== "rparen") throw new FormulaError("PARSE", "expected )");
        if (!FUNCTIONS.has(t.value)) {
          throw new FormulaError("PARSE", `unknown function "${t.value}"`);
        }
        return { kind: "call", name: t.value, args };
      }
      return { kind: "var", name: t.value };
    }
    throw new FormulaError("PARSE", `unexpected token "${t.value}"`);
  }
}

/** Variable scope: exact decimal strings keyed by formula variable id. */
export type FormulaScope = Readonly<Record<string, string>>;

function scopeToRationals(scope: FormulaScope): Map<string, Rational> {
  const map = new Map<string, Rational>();
  for (const [key, value] of Object.entries(scope)) {
    map.set(key, parseDecimal(value.trim()));
  }
  return map;
}

function evalNode(node: Node, vars: Map<string, Rational>): Rational {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var": {
      const v = vars.get(node.name);
      if (v === undefined) throw new FormulaError("EVAL", `unknown variable "${node.name}"`);
      return v;
    }
    case "neg":
      return rSub(R_ZERO, evalNode(node.operand, vars));
    case "bin": {
      const l = evalNode(node.lhs, vars);
      const r = evalNode(node.rhs, vars);
      switch (node.op) {
        case "+":
          return rAdd(l, r);
        case "-":
          return rSub(l, r);
        case "*":
          return rMul(l, r);
        case "/":
          return rDiv(l, r);
      }
      break;
    }
    case "call":
      return evalCall(node, vars);
  }
  /* c8 ignore next */
  throw new FormulaError("EVAL", "unreachable");
}

function evalCall(node: Extract<Node, { kind: "call" }>, vars: Map<string, Rational>): Rational {
  const args = node.args.map((a) => evalNode(a, vars));
  const need = (n: number) => {
    if (args.length !== n) {
      throw new FormulaError("EVAL", `${node.name}() expects ${n} argument(s), got ${args.length}`);
    }
  };
  switch (node.name) {
    case "min": {
      if (args.length === 0) throw new FormulaError("EVAL", "min() needs at least one argument");
      return args.reduce((acc, cur) => (rCompare(cur, acc) < 0 ? cur : acc));
    }
    case "max": {
      if (args.length === 0) throw new FormulaError("EVAL", "max() needs at least one argument");
      return args.reduce((acc, cur) => (rCompare(cur, acc) > 0 ? cur : acc));
    }
    case "abs": {
      need(1);
      const a = args[0]!;
      return a.n < 0n ? { n: -a.n, d: a.d } : a;
    }
    case "floor": {
      need(1);
      const a = args[0]!;
      const q = a.n / a.d;
      const floored = a.n < 0n && a.n % a.d !== 0n ? q - 1n : q;
      return rational(floored, 1n);
    }
    case "ceil": {
      need(1);
      const a = args[0]!;
      const q = a.n / a.d;
      const ceiled = a.n > 0n && a.n % a.d !== 0n ? q + 1n : q;
      return rational(ceiled, 1n);
    }
    case "round": {
      if (args.length !== 1 && args.length !== 2) {
        throw new FormulaError("EVAL", "round() expects 1 or 2 arguments");
      }
      const decimalsR = args[1] ?? R_ZERO;
      if (decimalsR.d !== 1n || decimalsR.n < 0n || decimalsR.n > 6n) {
        throw new FormulaError("EVAL", "round() decimals must be an integer in [0, 6]");
      }
      return roundRational(args[0]!, Number(decimalsR.n));
    }
  }
  /* c8 ignore next */
  throw new FormulaError("EVAL", `unknown function "${node.name}"`);
}

/**
 * Parse `formula` once into a reusable, validated compiled form. Throws
 * `FormulaError("PARSE", …)` for a syntactically invalid or unsupported formula.
 */
export interface CompiledFormula {
  evaluateScaled(scope: FormulaScope): bigint;
  evaluateMoney(scope: FormulaScope): Money;
  evaluateQty(scope: FormulaScope): Qty;
}

export function compileFormula(formula: string): CompiledFormula {
  const ast = new Parser(tokenize(formula)).parse();
  return {
    evaluateScaled: (scope) => toScaled(evalNode(ast, scopeToRationals(scope))),
    evaluateMoney: (scope) => Money.fromScaled(toScaled(evalNode(ast, scopeToRationals(scope)))),
    evaluateQty: (scope) => Qty.fromScaled(toScaled(evalNode(ast, scopeToRationals(scope)))),
  };
}

/** One-shot helpers (compile + evaluate). */
export function evaluateFormulaMoney(formula: string, scope: FormulaScope): Money {
  return compileFormula(formula).evaluateMoney(scope);
}
export function evaluateFormulaQty(formula: string, scope: FormulaScope): Qty {
  return compileFormula(formula).evaluateQty(scope);
}

/** Validate a formula at save time — throws `FormulaError("PARSE", …)` if invalid. */
export function assertFormulaValid(formula: string): void {
  new Parser(tokenize(formula)).parse();
}
