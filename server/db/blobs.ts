import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "./store.js";

type Db = import("node:sqlite").DatabaseSync;

/**
 * Image storage, content-addressed.
 *
 * The hash IS the name and IS the integrity check. Two people uploading the
 * same reference image get one file without anyone arranging deduplication, and
 * a corrupted file is detectable by rehashing rather than by noticing it looks
 * wrong.
 *
 * THIS IS THE FIRST THING IN THE SYSTEM THAT CANNOT BE REBUILT. Everything else
 * on saha.ing is derived — sessions can be re-issued, the board could be
 * re-imported. These bytes exist nowhere else, which is why deploy/backup.sh
 * ships alongside this file rather than after it.
 */

/** What we will store. Everything else is refused with its type named. */
const ACCEPTED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * SVG is deliberately absent.
 *
 * An SVG is a script container. It can carry <script>, event handlers, and
 * external references, and serving one from our own origin hands the author our
 * session cookie. This project has already been bitten by adversarial SVG once,
 * and "we sanitise it" is a claim that has to hold against every future parser
 * difference — a denylist of dangerous constructs is a bet, and an allowlist of
 * safe ones is nearly as hard.
 *
 * Refusing costs a user one conversion. Accepting costs us the first time
 * somebody uploads a clever one.
 */
export const REFUSED_TYPES: Record<string, string> = {
  "image/svg+xml": "SVG can carry scripts. Export it as PNG and upload that.",
  "text/html": "HTML is not an image.",
};

/** 12 MB. Big enough for a photograph, small enough that a mistake is cheap. */
export const MAX_BYTES = 12 * 1024 * 1024;

/** Magic bytes, because a content-type header is whatever the client says. */
function sniff(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 6).toString("latin1").startsWith("GIF8")) return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

export class BlobStore {
  constructor(private readonly db: Db, private readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  /**
   * Sharded two levels deep. A single directory with tens of thousands of
   * entries is slow to list and unpleasant to back up incrementally.
   */
  private pathFor(sha256: string, ext: string): string {
    const dir = join(this.root, sha256.slice(0, 2), sha256.slice(2, 4));
    mkdirSync(dir, { recursive: true });
    return join(dir, `${sha256}.${ext}`);
  }

  put(actorId: string, bytes: Buffer, filename?: string, declaredType?: string) {
    if (bytes.length === 0) throw new Refused("that file is empty", "EMPTY_FILE");
    if (bytes.length > MAX_BYTES) {
      throw new Refused(
        `that file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB`,
        "TOO_LARGE",
      );
    }

    // The declared type is a hint from the client and is never trusted. What
    // matters is what the bytes actually are.
    const actual = sniff(bytes);
    if (!actual) {
      const refusal = declaredType && REFUSED_TYPES[declaredType];
      throw new Refused(
        refusal ?? "that file is not an image type we store (PNG, JPEG, GIF, WebP or PDF)",
        "UNSUPPORTED_TYPE",
      );
    }
    if (!ACCEPTED[actual]) throw new Refused(`${actual} is not a type we store`, "UNSUPPORTED_TYPE");

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const existing = this.db.prepare("SELECT * FROM blobs WHERE sha256 = ?").get(sha256) as
      | Record<string, unknown>
      | undefined;
    // Identical bytes are the same blob. Re-uploading is not an error and does
    // not make a second copy; the first uploader keeps the attribution.
    if (existing) return existing;

    const ext = ACCEPTED[actual];
    const target = this.pathFor(sha256, ext);
    // Written to a temporary name and renamed, so a crash mid-write cannot
    // leave a truncated file sitting at a hash that promises its contents.
    const temp = `${target}.${process.pid}.part`;
    writeFileSync(temp, bytes);
    renameSync(temp, target);

    const size = dimensions(bytes, actual);
    const id = sha256.slice(0, 16);
    this.db.prepare(`INSERT INTO blobs (id,sha256,mime,bytes,width,height,filename,uploaded_by,uploaded_at)
                     VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, sha256, actual, bytes.length, size?.width ?? null, size?.height ?? null,
           filename?.slice(0, 200) ?? null, actorId, new Date().toISOString());
    return this.db.prepare("SELECT * FROM blobs WHERE id = ?").get(id) as Record<string, unknown>;
  }

  read(id: string): { bytes: Buffer; mime: string; sha256: string } {
    const row = this.db.prepare("SELECT sha256, mime FROM blobs WHERE id = ?").get(id) as
      | { sha256: string; mime: string }
      | undefined;
    if (!row) throw new Refused("no such file", "NOT_FOUND");
    const ext = ACCEPTED[row.mime];
    const path = this.pathFor(row.sha256, ext);
    try {
      statSync(path);
    } catch {
      // The row exists and the bytes do not. Say exactly that rather than a
      // generic 404 — it means the blob directory and the database have
      // diverged, which is a backup problem and needs to be noticed.
      throw new Refused("the record for that file exists but its bytes are missing on disk", "BLOB_MISSING");
    }
    return { bytes: readFileSync(path), mime: row.mime, sha256: row.sha256 };
  }
}

/**
 * Width and height, read from the header where it is cheap.
 *
 * Best effort on purpose: an unknown size is stored as null and the page lays
 * the image out once it loads. Guessing a size would make the board jump.
 */
function dimensions(bytes: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png") return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (mime === "image/gif") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset < bytes.length - 9) {
        if (bytes[offset] !== 0xff) { offset += 1; continue; }
        const marker = bytes[offset + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + bytes.readUInt16BE(offset + 2);
      }
    }
  } catch {
    // A malformed header is not a reason to refuse the upload.
  }
  return null;
}
