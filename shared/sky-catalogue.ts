/** Compact offline HYG subset. 16-byte header, 16 bytes per star. */
export const SKY_RECORD_BYTES = 16;
export const MAS_PER_RADIAN = 206264806.247;
export function decodeSkyCatalogue(buffer: ArrayBuffer): number[][] {
  const bytes = new Uint8Array(buffer);
  if (buffer.byteLength < 16 || String.fromCharCode(...bytes.slice(0, 8)) !== "SAHAHYG1") throw new Error("Invalid sky catalogue");
  const view = new DataView(buffer);
  const count = view.getUint32(8, true);
  if (view.getUint16(12, true) !== SKY_RECORD_BYTES || count > 20000 || buffer.byteLength !== 16 + count * SKY_RECORD_BYTES)
    throw new Error("Invalid sky catalogue size");
  return Array.from({ length: count }, (_, i) => {
    const at = 16 + i * SKY_RECORD_BYTES;
    return [view.getUint32(at, true), view.getUint16(at + 4, true) * 24 / 65535,
      view.getInt16(at + 6, true) * 90 / 32767, view.getInt16(at + 8, true) / 100,
      view.getInt16(at + 10, true) / 1000, view.getInt16(at + 12, true) / MAS_PER_RADIAN,
      view.getInt16(at + 14, true) / MAS_PER_RADIAN];
  });
}
