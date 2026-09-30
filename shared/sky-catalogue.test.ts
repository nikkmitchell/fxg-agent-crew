import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { decodeSkyCatalogue } from "./sky-catalogue";

test("packed catalogue stays small and preserves bright recognizable stars", () => {
  const binary = readFileSync(new URL("../src/space/sky/hyg-bright.bin", import.meta.url));
  const rows = decodeSkyCatalogue(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength));
  expect(binary.length).toBeLessThan(150000);
  expect(rows).toHaveLength(8920);
  // Sirius: 6h45m09s, -16deg42m58s, visual magnitude -1.44.
  const sirius = rows.find((s) => s[3] < -1.4)!;
  expect(sirius[1]).toBeCloseTo(6.75248, 3);
  expect(sirius[2]).toBeCloseTo(-16.7161, 2);
});
test("rejects incomplete or unexpected catalogues rather than producing broken geometry", () => {
  expect(() => decodeSkyCatalogue(new ArrayBuffer(10))).toThrow();
  expect(() => decodeSkyCatalogue(new ArrayBuffer(16))).toThrow();
});
