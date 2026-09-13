// Formatting is a read-only view; preserve number tokens and source text for editing.
export function jsonDisplayContent(content: string): string | null {
  if (content.length > 2_000_000 || !/^[\s]*[\[{]/u.test(content)) return null;
  try { JSON.parse(content); } catch { return null; }
  const tokens = content.match(/"(?:[^"\\]|\\.)*"|[^\s]/gu);
  if (!tokens) return null;
  let depth = 0;
  const output: string[] = [];
  let outputLength = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    // Bound expansion before allocating deeply indented output.
    outputLength += token.length + 2 * depth + 3;
    if (outputLength > 8_000_000) return null;
    if (token === "{" || token === "[") {
      output.push(token);
      depth++;
      if (depth > 100) return null;
      if (tokens[index + 1] !== "}" && tokens[index + 1] !== "]") output.push("\n", "  ".repeat(depth));
    } else if (token === "}" || token === "]") {
      depth--;
      if (tokens[index - 1] !== "{" && tokens[index - 1] !== "[") output.push("\n", "  ".repeat(depth));
      output.push(token);
    } else if (token === ",") output.push(",\n", "  ".repeat(depth));
    else if (token === ":") output.push(": ");
    else output.push(token);
  }
  const formatted = output.join("");
  return formatted.length <= 8_000_000 ? formatted : null;
}
