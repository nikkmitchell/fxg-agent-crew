import { useEffect, useSyncExternalStore } from "react";
import { SCREEN_LIMITS } from "../../shared/screens";

/**
 * SHARE MY SCREEN FROM THE ROOM'S OWN SETTINGS (Nikk, 7227: "add it as an
 * option under me in the settings, a toggle"). The same loop as share.html —
 * capture, shrink to 1280x720, WebP (JPEG where WebP cannot be encoded), one
 * picture a second — signed in by this page's own session, so no room needs
 * entering first and no link is minted.
 *
 * One share per page, whichever view turned it on: a module, not a component,
 * so closing the menu does not stop it.
 */
export type ScreenShareState = {
  sharing: boolean;
  starting: boolean;
  problem: string | null;
  /** My own screen open as a movable panel in the room (MyScreen.tsx). */
  shown: boolean;
  /**
   * Whether the room has a live picture of mine, from this page or any other
   * (saha.ing/share): the server's word, polled by useMyScreenLive. Knowing only
   * this page's own capture, the settings said "not sharing" while Nikk was
   * sharing from the share page (7244).
   */
  live: boolean;
};

let state: ScreenShareState = { sharing: false, starting: false, problem: null, shown: false, live: false };
const listeners = new Set<() => void>();
const set = (next: Partial<ScreenShareState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

let stream: MediaStream | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sending = false;
let base = "";

/** Open or close my own screen in the room, from either menu. */
export const setMyScreenShown = (shown: boolean) => set({ shown });

/**
 * ONE TOGGLE, SHOW MY SCREEN (Nikk, 7244: "we have share my screen and show my
 * screen ... we only need one"). On: open it in front of me, and if nothing of
 * mine is live yet and this browser can capture, start sharing. Off: close it,
 * and stop a share this page started.
 */
export function setMyScreen(on: boolean, root: string): void {
  set({ shown: on });
  if (on) {
    if (!state.live && !stream && canShareScreen()) void startScreenShare(root);
  } else void stopScreenShare();
}

/** Keep `live` up to date while something shows it: every few seconds, from the server's list of screens. */
export function useMyScreenLive(root: string, you: string | null): void {
  useEffect(() => {
    if (!you) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch(`${root}/bff/space/screens`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok || cancelled) return;
        const { screens } = (await response.json()) as { screens: { actorId: string }[] };
        const live = screens.some((screen) => screen.actorId.toLowerCase() === you.toLowerCase());
        if (live !== state.live) set({ live });
      } catch {
        // Next time.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [root, you]);
}

/** Whether this browser can share a screen at all (a headset's usually cannot). */
export const canShareScreen = (): boolean =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function";

export function useScreenShare(): ScreenShareState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

async function tick(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
  if (sending || !stream || !video.videoWidth) return;
  sending = true;
  try {
    const scale = Math.min(1, SCREEN_LIMITS.width / video.videoWidth, SCREEN_LIMITS.height / video.videoHeight);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    const as = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, SCREEN_LIMITS.quality));
    let blob = await as("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await as("image/jpeg");
    if (!blob || blob.size > SCREEN_LIMITS.bytes) return;
    const response = await fetch(`${base}/bff/space/screens/frame`, {
      method: "PUT",
      headers: { "content-type": blob.type },
      body: blob,
      credentials: "same-origin",
    });
    if (response.status === 401) await stopScreenShare("You are not signed in to saha.ing in this browser.");
    else set({ problem: response.ok ? null : `The room did not take that picture (${response.status}); still trying.` });
  } catch {
    set({ problem: "Could not reach saha.ing; still trying." });
  } finally {
    sending = false;
  }
}

export async function startScreenShare(root: string): Promise<void> {
  if (stream || state.starting) return;
  if (!canShareScreen()) {
    set({ problem: "This browser cannot share a screen. Use saha.ing in a desktop browser." });
    return;
  }
  base = root;
  set({ starting: true, problem: null });
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: SCREEN_LIMITS.width }, height: { ideal: SCREEN_LIMITS.height }, frameRate: { ideal: 1, max: 5 } },
      audio: false,
    });
  } catch {
    set({ starting: false, problem: "Screen sharing was not allowed, so nothing is being shared." });
    return;
  }
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const canvas = document.createElement("canvas");
  // The browser's own "Stop sharing" bar ends the track without telling the page.
  stream.getVideoTracks()[0]?.addEventListener("ended", () => void stopScreenShare(null));
  await video.play().catch(() => undefined);
  set({ starting: false, sharing: true });
  void tick(video, canvas);
  timer = setInterval(() => void tick(video, canvas), SCREEN_LIMITS.intervalMs);
}

export async function stopScreenShare(problem: string | null = null): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((track) => track.stop());
  const was = stream !== null;
  stream = null;
  set({ sharing: false, starting: false, problem });
  if (!was) return;
  try {
    await fetch(`${base}/bff/space/screens/frame`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    // The picture goes stale on its own within ten seconds.
  }
}

if (typeof window !== "undefined") window.addEventListener("pagehide", () => void stopScreenShare());
