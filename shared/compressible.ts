/**
 * WHICH FILES ARE WORTH A BROTLI COPY. One list for the build
 * (tools/precompress.mts, the site in dist/) and the server
 * (server/brotli-copies.ts: spaces' files and catalogue bodies), so a file
 * is never worth compressing in one place and not the other.
 *
 * Text compresses to a quarter. Models (glTF buffers, VRM bodies, their
 * animations, HDR skies) to about half: measured on dist, 36.5 MB of avatars
 * came to 15.4. Pictures, fonts, sound and video are compressed already and
 * come out the same size, so they are not listed.
 */
const TEXT = new Set(["js", "mjs", "css", "html", "json", "svg", "wasm", "md", "py", "txt", "xml", "csv"]);
const MODELS = new Set(["vrm", "vrma", "glb", "gltf", "bin", "hdr", "obj", "ply", "stl"]);

/** Below this the copy saves less than a header costs. */
export const SMALLEST_WORTH_COMPRESSING = 1024;
/** A copy that saves less than a tenth is not worth a second file on disk. */
export const WORTH_KEEPING = 0.9;

export function compressibleKind(file: string): "text" | "model" | null {
  const dot = file.lastIndexOf(".");
  if (dot < 0 || dot < file.lastIndexOf("/")) return null;
  const ext = file.slice(dot + 1).toLowerCase();
  return TEXT.has(ext) ? "text" : MODELS.has(ext) ? "model" : null;
}

/**
 * Whether an Accept-Encoding header takes brotli: "br" listed, and not with
 * q=0 (which means "never"). Every browser we support sends it over HTTPS;
 * curl and Python's urllib send nothing, and get the plain file.
 */
export function acceptsBrotli(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return value.split(",").some((part) => {
    const [name, ...params] = part.trim().split(";").map((piece) => piece.trim());
    if (name.toLowerCase() !== "br") return false;
    const q = params.find((param) => param.toLowerCase().startsWith("q="));
    return q === undefined || Number(q.slice(2)) > 0;
  });
}
