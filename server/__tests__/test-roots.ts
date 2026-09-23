import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testBlobRoot(): string {
  return join(tmpdir(), `blobs-${randomUUID()}`);
}
