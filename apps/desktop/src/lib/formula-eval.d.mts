// Type surface for formula-eval.mjs (allowJs is off; the .mjs body is shared
// with the node tests, so types live in this declaration).

export declare class FormulaError extends Error {}

export type CompiledFormula = {
  /** Column names the formula reads, each once. */
  variables: string[];
  /** Returns the row's value, or null when an input is missing or undefined. */
  evaluate: (lookup: (name: string) => number | null | undefined) => number | null;
};

export declare const FORMULA_FUNCTION_NAMES: string[];
export declare function compileFormula(source: string): CompiledFormula;
