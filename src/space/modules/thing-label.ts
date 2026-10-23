/**
 * The words over a thing: what is wrong with it first (pink, with its name, for whoever is building), then
 * what moving it says, then its own caption, as the thing wrote it.
 */
export function thingLabel(
  name: string,
  says: { missing?: string | null; problem?: string | null; notice?: string | null; caption?: string | null },
): { text: string; trouble: boolean } | null {
  const trouble = says.missing ?? says.problem;
  if (trouble) return { text: `${name}: ${trouble}`, trouble: true };
  if (says.notice) return { text: `${name}: ${says.notice}`, trouble: false };
  return says.caption ? { text: says.caption, trouble: false } : null;
}
