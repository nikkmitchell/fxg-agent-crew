import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAvatarTake, loadAvatarTake, saveAvatarTake,
  type AvatarFrame, type AvatarTake,
} from "./avatar-recording";
import { avatarMicrophone } from "./avatar-microphone";
import { base } from "../router";

const MAX_MS = 120_000;
const SAMPLE_MS = 50;
type Capture = Omit<AvatarFrame, "t">;
type Pending = { startAt: number; lastAt: number; frames: AvatarFrame[]; stream: MediaStream; media: MediaRecorder; chunks: Blob[]; actorId: string; body: string | null; showPersonalUi: boolean };
type PublishedTake = { actorId: string; durationMs: number; publishedAt: string };

export type AvatarRecorder = ReturnType<typeof useAvatarRecorder>;

export function useAvatarRecorder(owner: string | null, callMicrophone: () => MediaStream | null, inCall: boolean) {
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "saving">("idle");
  const [take, setTake] = useState<AvatarTake | null>(null);
  const [published, setPublished] = useState<PublishedTake[]>([]);
  const [welcomeCompleted, setWelcomeCompleted] = useState(true);
  const [canPublish, setCanPublish] = useState(false);
  const [activeTake, setActiveTake] = useState<AvatarTake | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showPersonalUi, setShowPersonalUi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const playerUrl = useRef<string | null>(null);
  const startBusy = useRef(false);
  const queue = useRef<PublishedTake[]>([]);
  const playbackGeneration = useRef(0);
  const publishedCache = useRef(new Map<string, AvatarTake>());

  const refreshWelcome = useCallback(async () => {
    const response = await fetch(`${base}/bff/space/welcome`, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load welcome recordings.");
    const data = await response.json() as { canPublish: boolean; completed: boolean; takes: PublishedTake[] };
    setCanPublish(data.canPublish);
    setWelcomeCompleted(data.completed);
    setPublished(data.takes);
  }, []);

  useEffect(() => { if (owner) void refreshWelcome().catch(() => setNotice("Could not load welcome recordings.")); }, [owner, refreshWelcome]);

  useEffect(() => {
    if (!owner) { setTake(null); return; }
    let live = true;
    void loadAvatarTake(owner).then((saved) => {
      if (live) { setTake(saved); setShowPersonalUi(saved?.showPersonalUi ?? false); }
    }).catch(() => { if (live) setNotice("This browser could not open saved recordings."); });
    return () => { live = false; };
  }, [owner]);

  const stopPlayback = useCallback(() => {
    playbackGeneration.current += 1;
    queue.current = [];
    player.current?.pause();
    player.current = null;
    if (playerUrl.current) URL.revokeObjectURL(playerUrl.current);
    playerUrl.current = null;
    setPlaying(false);
    setActiveTake(null);
  }, []);

  const playTake = useCallback(async (selected: AvatarTake, next: () => void) => {
    player.current?.pause();
    if (playerUrl.current) URL.revokeObjectURL(playerUrl.current);
    const url = URL.createObjectURL(selected.audio);
    const audio = new Audio(url);
    player.current = audio;
    playerUrl.current = url;
    setActiveTake(selected);
    audio.onended = next;
    audio.onerror = () => { setNotice("This browser could not play the recorded audio."); stopPlayback(); };
    try { await audio.play(); setPlaying(true); }
    catch { setNotice("Audio playback was blocked. Tap Play welcome again."); stopPlayback(); }
  }, [stopPlayback]);

  const stop = useCallback(async () => {
    const session = pending.current;
    if (!session) return;
    pending.current = null;
    setStatus("saving");
    const audio = session.media.state === "inactive"
      ? new Blob(session.chunks, { type: session.media.mimeType || "audio/webm" })
      : await new Promise<Blob>((resolve) => {
          session.media.onstop = () => resolve(new Blob(session.chunks, { type: session.media.mimeType || "audio/webm" }));
          session.media.stop();
        });
    session.stream.getTracks().forEach((track) => track.stop());
    try {
      if (session.frames.length < 2 || audio.size === 0) throw new Error("No movement or audio was captured. Try again.");
      const result: AvatarTake = {
        version: 1,
        recordedAt: Date.now(),
        durationMs: session.frames[session.frames.length - 1].t,
        actorId: session.actorId,
        body: session.body,
        showPersonalUi: session.showPersonalUi,
        frames: session.frames,
        audio,
      };
      await saveAvatarTake(result);
      setTake(result);
      setNotice("Saved on this browser. Play the take to review it in the lobby.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the recording.");
    } finally {
      setStatus("idle");
    }
  }, []);

  const capture = useCallback((frame: Capture) => {
    const session = pending.current;
    if (!session) return;
    const now = performance.now();
    if (now - session.lastAt < SAMPLE_MS) return;
    session.lastAt = now;
    session.frames.push({ ...frame, t: now - session.startAt });
    if (now - session.startAt >= MAX_MS) void stop();
  }, [stop]);

  const start = useCallback(async (actorId: string, body: string | null) => {
    if (pending.current || startBusy.current || actorId !== owner) return;
    startBusy.current = true;
    stopPlayback();
    setStatus("starting");
    setNotice(null);
    let stream: MediaStream | null = null;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record microphone audio.");
      stream = await avatarMicrophone(callMicrophone, inCall);
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value));
      const media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onerror = () => { setNotice("The microphone recording failed."); void stop(); };
      media.start(250);
      pending.current = { startAt: performance.now(), lastAt: -Infinity, frames: [], stream, media, chunks, actorId, body, showPersonalUi };
      setStatus("recording");
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      setNotice(error instanceof Error ? error.message : "Could not start recording.");
      setStatus("idle");
    } finally {
      startBusy.current = false;
    }
  }, [callMicrophone, inCall, owner, showPersonalUi, stop, stopPlayback]);

  const play = useCallback(async () => {
    if (!take || status !== "idle") return;
    stopPlayback();
    await playTake(take, stopPlayback);
  }, [status, take, stopPlayback, playTake]);

  const finishWelcome = useCallback(() => {
    stopPlayback();
    setWelcomeCompleted(true);
    void fetch(`${base}/bff/space/welcome/complete`, { method: "POST", credentials: "same-origin" }).catch(() => setNotice("Could not save welcome progress."));
  }, [stopPlayback]);
  const loadPublished = useCallback(async (item: PublishedTake): Promise<AvatarTake> => {
    const key = `${item.actorId}:${item.publishedAt}`;
    const cached = publishedCache.current.get(key);
    if (cached) return cached;
    const root = `${base}/bff/space/welcome/${encodeURIComponent(item.actorId)}`;
    const version = `?v=${encodeURIComponent(item.publishedAt)}`;
    const [takeResponse, audioResponse] = await Promise.all([
      fetch(`${root}/take${version}`, { credentials: "same-origin" }),
      fetch(`${root}/audio${version}`, { credentials: "same-origin" }),
    ]);
    if (!takeResponse.ok || !audioResponse.ok) throw new Error("Could not load a welcome tutorial.");
    const take = { ...await takeResponse.json() as Omit<AvatarTake, "audio">, audio: await audioResponse.blob() };
    publishedCache.current.set(key, take);
    return take;
  }, []);
  const playWelcome = useCallback(() => {
    if (!published.length) return;
    stopPlayback();
    const generation = playbackGeneration.current;
    queue.current = [...published];
    const next = () => {
      const item = queue.current.shift();
      if (!item) { finishWelcome(); return; }
      void loadPublished(item).then((loaded) => {
        if (generation !== playbackGeneration.current) return;
        void playTake(loaded, next);
      }).catch(() => { if (generation === playbackGeneration.current) { setNotice("Could not load a welcome tutorial. Tap Play to retry."); stopPlayback(); } });
    };
    next();
  }, [published, stopPlayback, playTake, finishWelcome, loadPublished]);

  const publish = useCallback(async () => {
    if (!take || !canPublish) return;
    try {
      setNotice("Uploading welcome recording…");
      const bytes = new Uint8Array(await take.audio.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const response = await fetch(`${base}/bff/space/welcome`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...take, audio: undefined, audioBase64: btoa(binary), audioMime: take.audio.type }) });
      if (!response.ok) throw new Error("Upload failed. Your browser draft is safe.");
      await refreshWelcome();
      setNotice("Published. New visitors can play this tutorial in the lobby.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed."); }
  }, [take, canPublish, refreshWelcome]);

  const unpublish = useCallback(async () => {
    const response = await fetch(`${base}/bff/space/welcome`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) { await refreshWelcome(); setNotice("Welcome tutorial unpublished."); }
    else setNotice("Could not unpublish the tutorial.");
  }, [refreshWelcome]);

  const discard = useCallback(async () => {
    stopPlayback();
    try { if (!take) return; await deleteAvatarTake(take.actorId); setTake(null); setNotice("Draft discarded."); }
    catch { setNotice("Could not remove the saved draft."); }
  }, [stopPlayback, take]);

  const choosePersonalUi = useCallback((shown: boolean) => {
    setShowPersonalUi(shown);
    if (take) {
      const changed = { ...take, showPersonalUi: shown };
      setTake(changed);
      void saveAvatarTake(changed).catch(() => setNotice("Could not save the personal UI setting."));
    }
  }, [take]);

  useEffect(() => () => {
    pending.current?.media.stop();
    pending.current?.stream.getTracks().forEach((track) => track.stop());
    player.current?.pause();
    if (playerUrl.current) URL.revokeObjectURL(playerUrl.current);
  }, []);

  return { status, take, activeTake, published, welcomeCompleted, canPublish, playing, showPersonalUi, setShowPersonalUi: choosePersonalUi, notice, capture, start, stop, play, playWelcome, finishWelcome, publish, unpublish, stopPlayback, discard, player };
}
