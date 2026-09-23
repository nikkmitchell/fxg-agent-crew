/**
 * Reading JSX structure out of source, for tests that assert on it.
 *
 * Used by the tests that hold the room's pointer rules — which meshes may catch
 * a ray, and which grab handles must work without window events — because those
 * are properties of the component tree that no screenshot settles and no unit
 * test of the maths can see.
 */
/**
 * A JSX tag scanner, because this project has no JSX parser to hand.
 *
 * TypeScript here is 7.x, the native port, and its package no longer exposes
 * the JavaScript compiler API — `ts.ScriptTarget` is simply undefined — which I
 * found by writing this test against it first and watching it fail on the
 * import. Adding a parser dependency for one test is the wrong trade.
 *
 * IT REFUSES RATHER THAN GUESSES. A closing tag that does not match the open
 * one, or a tag left open at the end, throws. That matters more than it sounds:
 * a scanner that quietly mis-nested the file would find no offenders and this
 * test would pass for the wrong reason, which is the one outcome worse than not
 * having it at all.
 */
export type Tag = { name: string; attrs: string; line: number; parents: { name: string; attrs: string }[] };

export function scanJsx(source: string): Tag[] {
  const found: Tag[] = [];
  const stack: { name: string; attrs: string }[] = [];
  const n = source.length;
  const lineAt = (at: number) => source.slice(0, at).split("\n").length;

  /** Past a string or template literal starting at `at`. */
  const pastQuoted = (at: number): number => {
    const quote = source[at];
    let j = at + 1;
    while (j < n && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
    return j + 1;
  };

  /** Past a balanced `{ ... }` starting at `at`, respecting strings inside it. */
  const pastBraces = (at: number): number => {
    let depth = 0;
    let j = at;
    while (j < n) {
      const c = source[j];
      if (c === "'" || c === '"' || c === "`") {
        j = pastQuoted(j);
        continue;
      }
      if (c === "{") depth += 1;
      if (c === "}") {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
      j += 1;
    }
    throw new Error(`unbalanced braces from line ${lineAt(at)}`);
  };

  /** Whether a `<` here opens JSX rather than a generic or a comparison. */
  const opensJsx = (at: number): boolean => {
    if (!/[A-Za-z]/.test(source[at + 1] ?? "")) return false;
    let j = at - 1;
    while (j >= 0 && /\s/.test(source[j])) j -= 1;
    if (j < 0) return true;
    if ("(,=?:&|{}>[".includes(source[j])) return true;
    // `return <group>` — the one keyword that precedes JSX directly.
    return source.slice(Math.max(0, j - 5), j + 1) === "return";
  };

  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end < 0) break;
      i = end;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i) + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i = pastQuoted(i);
      continue;
    }

    if (c === "<" && source[i + 1] === "/") {
      const close = source.indexOf(">", i);
      const name = source.slice(i + 2, close).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new Error(`</${name}> at line ${lineAt(i)} closes <${open?.name ?? "nothing"}>`);
      }
      i = close + 1;
      continue;
    }

    // A fragment, `<>`, opens a group with no name and no attributes.
    if (c === "<" && source[i + 1] === ">") {
      found.push({ name: "", attrs: "", line: lineAt(i), parents: [...stack] });
      stack.push({ name: "", attrs: "" });
      i += 2;
      continue;
    }

    if (c === "<" && opensJsx(i)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(source[j])) j += 1;
      const name = source.slice(i + 1, j);
      const headerStart = j;
      while (j < n && source[j] !== ">") {
        if (source[j] === "{") {
          j = pastBraces(j);
          continue;
        }
        if (source[j] === '"' || source[j] === "'") {
          j = pastQuoted(j);
          continue;
        }
        j += 1;
      }
      const selfClosing = source[j - 1] === "/";
      const attrs = source.slice(headerStart, selfClosing ? j - 1 : j);
      found.push({ name, attrs, line: lineAt(i), parents: [...stack] });
      if (!selfClosing) stack.push({ name, attrs });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  if (stack.length) throw new Error(`left open at the end: ${stack.map((t) => `<${t.name}>`).join(" ")}`);
  return found;
}

