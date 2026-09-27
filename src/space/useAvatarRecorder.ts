import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAvatarTake, loadAvatarTake, saveAvatarTake,
  type AvatarFrame, type AvatarTake,
} from "./avatar-recording";

const MAX_MS = 120_000;
const SAMPLE_MS = 50;
type Capture = Omit<AvatarFrame, "t">;
type Pending = { startAt: number; lastAt: number; frames: AvatarFrame[]; stream: MediaStream; media: MediaRecorder; chunks: Blob[]; actorId: string; body: string | null; showPersonalUi: boolean };

export type AvatarRecorder = ReturnType<typeof useAvatarRecorder>;

export function useAvatarRecorder(owner: string | null) {
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "saving">("idle");
  const [take, setTake] = useState<AvatarTake | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showPersonalUi, setShowPersonalUi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef<Pending | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const playerUrl = useRef<string | null>(null);
  const startBusy = useRef(false);

  useEffect(() => {
    if (!owner) { setTake(null); return; }
    let live = true;
    void loadAvatarTake(owner).then((saved) => {
      if (live) { setTake(saved); setShowPersonalUi(saved?.showPersonalUi ?? false); }
    }).catch(() => { if (live) setNotice("This browser could not open saved recordings."); });
    return () => { live = false; };
  }, [owner]);

  const stopPlayback = useCallback(() => {
    player.current?.pause();
    player.current = null;
    if (playerUrl.current) URL.revokeObjectURL(playerUrl.current);
    playerUrl.current = null;
    setPlaying(false);
  }, []);

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
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This browser cannot record microphone audio.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  }, [owner, showPersonalUi, stop, stopPlayback]);

  const play = useCallback(async () => {
    if (!take || status !== "idle") return;
    stopPlayback();
    const url = URL.createObjectURL(take.audio);
    const audio = new Audio(url);
    player.current = audio;
    playerUrl.current = url;
    audio.onended = stopPlayback;
    audio.onerror = () => { setNotice("This browser could not play the recorded audio."); stopPlayback(); };
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setNotice("Audio playback was blocked. Tap Play again.");
      stopPlayback();
    }
  }, [status, take, stopPlayback]);

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

  return { status, take, playing, showPersonalUi, setShowPersonalUi: choosePersonalUi, notice, capture, start, stop, play, stopPlayback, discard, player };
}
