// A small expression language for computed columns: arithmetic over other
// columns, the way DataWarrior's "Add Calculated Values" works.
//
// Parsed and evaluated by hand rather than through eval or new Function: a
// formula is user input that would otherwise run with the app's full
// privileges, and a recursive-descent parser over a fixed grammar can only
// ever produce a number.

const FUNCTIONS = {
  abs: { arity: 1, apply: (x) => Math.abs(x) },
  sqrt: { arity: 1, apply: (x) => (x < 0 ? null : Math.sqrt(x)) },
  exp: { arity: 1, apply: (x) => Math.exp(x) },
  ln: { arity: 1, apply: (x) => (x <= 0 ? null : Math.log(x)) },
  log: { arity: 1, apply: (x) => (x <= 0 ? null : Math.log10(x)) },
  log10: { arity: 1, apply: (x) => (x <= 0 ? null : Math.log10(x)) },
  log2: { arity: 1, apply: (x) => (x <= 0 ? null : Math.log2(x)) },
  round: { arity: 1, apply: (x) => Math.round(x) },
  floor: { arity: 1, apply: (x) => Math.floor(x) },
  ceil: { arity: 1, apply: (x) => Math.ceil(x) },
  min: { arity: 2, apply: (x, y) => Math.min(x, y) },
  max: { arity: 2, apply: (x, y) => Math.max(x, y) },
  pow: { arity: 2, apply: (x, y) => x ** y },
  if: { arity: 3, apply: (condition, whenTrue, whenFalse) => (condition ? whenTrue : whenFalse) },
};

export const FORMULA_FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

const COMPARISONS = {
  "<": (a, b) => a < b,
  ">": (a, b) => a > b,
  "<=": (a, b) => a <= b,
  ">=": (a, b) => a >= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

class FormulaError extends Error {}

function tokenize(source) {
  const tokens = [];
  let position = 0;
  while (position < source.length) {
    const character = source[position];
    if (/\s/u.test(character)) {
      position += 1;
      continue;
    }
    // Bracketed names carry spaces and punctuation: [Molecular Weight].
    if (character === "[") {
      const end = source.indexOf("]", position);
      if (end < 0) throw new FormulaError("Unclosed [ in the formula.");
      tokens.push({ type: "name", value: source.slice(position + 1, end).trim() });
      position = end + 1;
      continue;
    }
    if (/[0-9]/u.test(character) || (character === "." && /[0-9]/u.test(source[position + 1] ?? ""))) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/u.exec(source.slice(position));
      if (!match) throw new FormulaError(`Cannot read a number at position ${position + 1}.`);
      tokens.push({ type: "number", value: Number(match[0]) });
      position += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      const match = /^[A-Za-z_][A-Za-z0-9_.]*/u.exec(source.slice(position));
      tokens.push({ type: "word", value: match[0] });
      position += match[0].length;
      continue;
    }
    const twoCharacter = source.slice(position, position + 2);
    if (COMPARISONS[twoCharacter]) {
      tokens.push({ type: "op", value: twoCharacter });
      position += 2;
      continue;
    }
    if ("+-*/^(),".includes(character) || COMPARISONS[character]) {
      tokens.push({ type: "op", value: character });
      position += 1;
      continue;
    }
    throw new FormulaError(`Unexpected character ${JSON.stringify(character)} in the formula.`);
  }
  return tokens;
}

function parse(tokens) {
  let cursor = 0;
  const peek = () => tokens[cursor];
  const eat = (value) => {
    const token = tokens[cursor];
    if (!token || token.value !== value) throw new FormulaError(`Expected ${value} in the formula.`);
    cursor += 1;
    return token;
  };

  function parseExpression() {
    const left = parseAdditive();
    const token = peek();
    if (token?.type === "op" && COMPARISONS[token.value]) {
      cursor += 1;
      return { kind: "compare", op: token.value, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive() {
    let node = parseMultiplicative();
    for (;;) {
      const token = peek();
      if (token?.type !== "op" || (token.value !== "+" && token.value !== "-")) return node;
      cursor += 1;
      node = { kind: "binary", op: token.value, left: node, right: parseMultiplicative() };
    }
  }

  function parseMultiplicative() {
    let node = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.type !== "op" || (token.value !== "*" && token.value !== "/")) return node;
      cursor += 1;
      node = { kind: "binary", op: token.value, left: node, right: parseUnary() };
    }
  }

  function parseUnary() {
    const token = peek();
    if (token?.type === "op" && (token.value === "-" || token.value === "+")) {
      cursor += 1;
      const operand = parseUnary();
      return token.value === "-" ? { kind: "negate", operand } : operand;
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePrimary();
    const token = peek();
    if (token?.type === "op" && token.value === "^") {
      cursor += 1;
      // Right associative, so 2^3^2 is 2^(3^2).
      return { kind: "binary", op: "^", left: base, right: parseUnary() };
    }
    return base;
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new FormulaError("The formula ends too early.");
    if (token.type === "number") {
      cursor += 1;
      return { kind: "number", value: token.value };
    }
    if (token.type === "name") {
      cursor += 1;
      return { kind: "variable", name: token.value };
    }
    if (token.type === "word") {
      const lowered = token.value.toLowerCase();
      if (FUNCTIONS[lowered] && tokens[cursor + 1]?.value === "(") {
        cursor += 1;
        eat("(");
        const args = [];
        if (peek()?.value !== ")") {
          args.push(parseExpression());
          while (peek()?.value === ",") {
            cursor += 1;
            args.push(parseExpression());
          }
        }
        eat(")");
        const expected = FUNCTIONS[lowered].arity;
        if (args.length !== expected) {
          throw new FormulaError(`${lowered} takes ${expected} argument${expected === 1 ? "" : "s"}.`);
        }
        return { kind: "call", name: lowered, args };
      }
      cursor += 1;
      return { kind: "variable", name: token.value };
    }
    if (token.value === "(") {
      cursor += 1;
      const node = parseExpression();
      eat(")");
      return node;
    }
    throw new FormulaError(`Unexpected ${JSON.stringify(String(token.value))} in the formula.`);
  }

  const node = parseExpression();
  if (cursor < tokens.length) {
    throw new FormulaError(`Unexpected ${JSON.stringify(String(tokens[cursor].value))} in the formula.`);
  }
  return node;
}

function collectVariables(node, into) {
  if (node.kind === "variable") into.add(node.name);
  for (const key of ["left", "right", "operand"]) {
    if (node[key]) collectVariables(node[key], into);
  }
  for (const argument of node.args ?? []) collectVariables(argument, into);
  return into;
}

/**
 * Parses a formula once. Throws FormulaError on a bad formula; the returned
 * compiled form evaluates per row and never throws.
 */
export function compileFormula(source) {
  const text = String(source ?? "").trim();
  if (!text) throw new FormulaError("The formula is empty.");
  const node = parse(tokenize(text));
  const variables = [...collectVariables(node, new Set())];
  const evaluate = (lookup) => {
    // A row missing any input has no answer - not a zero, and not a crash.
    const walk = (current) => {
      switch (current.kind) {
        case "number":
          return current.value;
        case "variable": {
          const value = lookup(current.name);
          return typeof value === "number" && Number.isFinite(value) ? value : null;
        }
        case "negate": {
          const operand = walk(current.operand);
          return operand === null ? null : -operand;
        }
        case "binary": {
          const left = walk(current.left);
          const right = walk(current.right);
          if (left === null || right === null) return null;
          if (current.op === "+") return left + right;
          if (current.op === "-") return left - right;
          if (current.op === "*") return left * right;
          if (current.op === "/") return right === 0 ? null : left / right;
          return left ** right;
        }
        case "compare": {
          const left = walk(current.left);
          const right = walk(current.right);
          if (left === null || right === null) return null;
          return COMPARISONS[current.op](left, right) ? 1 : 0;
        }
        case "call": {
          const args = current.args.map(walk);
          if (args.some((value) => value === null)) return null;
          // if() keeps its branches lazy in spirit but both are already
          // numbers here; a null branch is what makes the whole thing null.
          const result = FUNCTIONS[current.name].apply(...(current.name === "if"
            ? [args[0] !== 0, args[1], args[2]]
            : args));
          return typeof result === "number" && Number.isFinite(result) ? result : null;
        }
        default:
          return null;
      }
    };
    const value = walk(node);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return { variables, evaluate };
}

export { FormulaError };
