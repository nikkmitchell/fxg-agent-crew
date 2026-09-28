import type { HandPose, Pose, Quat } from "../../shared/space-wire";
import type { Vec3 } from "../../shared/space-layout";
import type { AvatarState } from "../../shared/avatar-motion";

export type RecordedControl = { p: Vec3; q?: Quat } | null;
export type RecordedPerson = { actorId: string; kind: "human" | "agent"; body: string | null; head: Pose; hands: { left: HandPose | null; right: HandPose | null }; avatar: AvatarState };
export type AvatarFrame = {
  t: number;
  head: Pose;
  hands: { left: HandPose | null; right: HandPose | null };
  balls: { left: RecordedControl; leftShadow: RecordedControl; right: RecordedControl; rightShadow: RecordedControl };
  micBar: RecordedControl;
  personalUi: RecordedControl;
  others?: RecordedPerson[];
};

export type AvatarTake = {
  version: 1;
  recordedAt: number;
  durationMs: number;
  actorId: string;
  id?: string;
  title?: string;
  serverId?: string;
  uploadId?: string;
  includeHumans?: boolean;
  includeAgents?: boolean;
  body: string | null;
  showPersonalUi: boolean;
  frames: AvatarFrame[];
  audio: Blob;
};

const DATABASE = "saha-avatar-recorder";
const STORE = "drafts";
const key = (actorId: string) => `lobby-welcome-v1:${actorId.toLowerCase()}`;
const clipKey = (actorId: string, id: string) => `lobby-clip-v2:${actorId.toLowerCase()}:${id}`;

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listAvatarTakes(actorId: string): Promise<AvatarTake[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as AvatarTake[]).filter((take) => take?.actorId?.toLowerCase() === actorId.toLowerCase()).map((take) => ({ ...take, id: take.id ?? `legacy-${take.actorId.toLowerCase()}`, title: take.title ?? "First recording" })).sort((a, b) => b.recordedAt - a.recordedAt));
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadAvatarTake(actorId: string): Promise<AvatarTake | null> {
  return (await listAvatarTakes(actorId))[0] ?? null;
}

export async function saveAvatarTake(take: AvatarTake): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(take, take.id && !take.id.startsWith("legacy-") ? clipKey(take.actorId, take.id) : key(take.actorId));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function deleteAvatarTake(actorId: string, id?: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(id?.startsWith("legacy-") || !id ? key(actorId) : clipKey(actorId, id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

/** Nearest measured pose; controls are deliberately never invented between samples. */
export function frameAt(frames: readonly AvatarFrame[], timeMs: number): AvatarFrame | null {
  if (!frames.length) return null;
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= timeMs) low = middle;
    else high = middle - 1;
  }
  return frames[low];
}
