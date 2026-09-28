import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAvatarTake, listAvatarTakes, saveAvatarTake,
  type AvatarFrame, type AvatarTake,
} from "./avatar-recording";
import { avatarMicrophone } from "./avatar-microphone";
import { avatarAudioMix } from "./avatar-audio-mix";
import { base } from "../router";
import type { WirePerson } from "../../shared/space-wire";

const SAMPLE_MS = 50;
type Capture = Omit<AvatarFrame, "t">;
type Pending = { startAt: number; recordedAt: number; lastAt: number; frames: AvatarFrame[]; stream: MediaStream; mix: ReturnType<typeof avatarAudioMix>; media: MediaRecorder; chunks: Blob[]; actorId: string; body: string | null; showPersonalUi: boolean; includeHumans: boolean; includeAgents: boolean };
type PublishedTake = { actorId: string; durationMs: number; publishedAt: string };
type UploadedTake = Pick<PublishedTake, "actorId" | "publishedAt">;
type UploadedClip = { id: string; actorId: string; title: string; durationMs: number; uploadedAt: string; active: boolean };

export type AvatarRecorder = ReturnType<typeof useAvatarRecorder>;

export function useAvatarRecorder(owner: string | null, callMicrophone: () => MediaStream | null, inCall: boolean, people: () => WirePerson[], remoteAudio: () => Map<string, MediaStream>, mutedAudio: () => Set<string>) {
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "saving" | "uploading">("idle");
  const [takes, setTakes] = useState<AvatarTake[]>([]);
  const [take, setTake] = useState<AvatarTake | null>(null);
  const [includeHumans, setIncludeHumans] = useState(false);
  const [includeAgents, setIncludeAgents] = useState(false);
  const [allowInOthersClips, setAllowInOthersClips] = useState(false);
  const consented = useRef(new Set<string>());
  const consentedAtStart = useRef(new Set<string>());
  const [published, setPublished] = useState<PublishedTake[]>([]);
  const [uploadedMine, setUploadedMine] = useState<UploadedTake | null>(null);
  const [uploadedClips, setUploadedClips] = useState<UploadedClip[]>([]);
  const [uploadedClip, setUploadedClip] = useState<UploadedClip | null>(null);
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
    const data = await response.json() as { canPublish: boolean; uploadedMine: UploadedTake | null; completed: boolean; takes: PublishedTake[] };
    setCanPublish(data.canPublish);
    setUploadedMine(data.uploadedMine);
    setWelcomeCompleted(data.completed);
    setPublished(data.takes);
    const clipsResponse = await fetch(`${base}/bff/space/welcome/clips`, { credentials: "same-origin" });
    if (clipsResponse.ok) {
      const clips = (await clipsResponse.json() as { clips: UploadedClip[] }).clips;
      setUploadedClips(clips);
      setUploadedClip((previous) => clips.find((clip) => clip.id === previous?.id) ?? clips[0] ?? null);
    }
  }, []);

  useEffect(() => { if (owner) void refreshWelcome().catch(() => setNotice("Could not load welcome recordings.")); }, [owner, refreshWelcome]);
  const refreshConsent = useCallback(async () => {
    const response = await fetch(`${base}/bff/space/welcome/consent`, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not check recording permissions.");
    const data = await response.json() as { mine: boolean; allowed: string[] };
    consented.current = new Set(data.allowed.map((name) => name.toLowerCase()));
    setAllowInOthersClips(data.mine);
  }, []);
  useEffect(() => {
    if (!owner) return;
    void refreshConsent().catch(() => setNotice("Could not check recording permissions."));
    if (status !== "recording") return;
    const timer = window.setInterval(() => void refreshConsent().catch(() => setNotice("Could not refresh recording permissions.")), 1000);
    return () => window.clearInterval(timer);
  }, [owner, status, refreshConsent]);
  const setRecordingConsent = useCallback(async (allowed: boolean) => {
    const response = await fetch(`${base}/bff/space/welcome/consent`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowed }) });
    if (!response.ok) { setNotice("Could not change recording permission."); return; }
    setAllowInOthersClips(allowed);
    if (owner) { if (allowed) consented.current.add(owner.toLowerCase()); else consented.current.delete(owner.toLowerCase()); }
  }, [owner]);
  const consentingPeople = useCallback(() => people().filter((person) => person.connected && consentedAtStart.current.has(person.actorId.toLowerCase()) && consented.current.has(person.actorId.toLowerCase())), [people]);

  useEffect(() => {
    if (!owner) { setTake(null); setTakes([]); return; }
    let live = true;
    void listAvatarTakes(owner).then((saved) => {
      if (live) { setTakes(saved); setTake(saved[0] ?? null); setShowPersonalUi(saved[0]?.showPersonalUi ?? false); }
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
    session.mix.stop();
    session.stream.getTracks().forEach((track) => track.stop());
    try {
      if (session.frames.length < 2 || audio.size === 0) throw new Error("No movement or audio was captured. Try again.");
      const result: AvatarTake = {
        version: 1,
        id: crypto.randomUUID(),
        title: `Clip ${takes.length + 1}`,
        recordedAt: session.recordedAt,
        durationMs: session.frames[session.frames.length - 1].t,
        actorId: session.actorId,
        body: session.body,
        showPersonalUi: session.showPersonalUi,
        includeHumans: session.includeHumans,
        includeAgents: session.includeAgents,
        frames: session.frames,
        audio,
      };
      await saveAvatarTake(result);
      setTakes((previous) => [result, ...previous]);
      setTake(result);
      setNotice("Saved as a new clip on this browser. Name and review it before uploading.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the recording.");
    } finally {
      setStatus("idle");
    }
  }, [takes.length]);

  const capture = useCallback((frame: Capture) => {
    const session = pending.current;
    if (!session) return;
    const now = performance.now();
    if (now - session.lastAt < SAMPLE_MS) return;
    session.lastAt = now;
    const others = consentingPeople().filter((person) => person.actorId !== session.actorId && ((person.kind === "human" && session.includeHumans) || (person.kind === "agent" && session.includeAgents))).map((person) => {
      const angle = person.facing / 2;
      return {
        actorId: person.actorId,
        kind: person.kind as "human" | "agent",
        body: person.body ?? null,
        head: structuredClone(person.head ?? { p: { x: person.at.x, y: person.kind === "agent" ? 1.55 : 1.65, z: person.at.z }, q: { x: 0, y: Math.sin(angle), z: 0, w: Math.cos(angle) } }),
        hands: structuredClone(person.hands),
        avatar: structuredClone(person.avatar),
      };
    });
    session.mix.update(remoteAudio(), mutedAudio());
    session.frames.push({ ...frame, others, t: now - session.startAt });
  }, [consentingPeople, remoteAudio, mutedAudio]);

  const start = useCallback(async (actorId: string, body: string | null) => {
    if (pending.current || startBusy.current || actorId !== owner) return;
    startBusy.current = true;
    stopPlayback();
    setStatus("starting");
    setNotice(null);
    let stream: MediaStream | null = null;
    let mix: ReturnType<typeof avatarAudioMix> | null = null;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record microphone audio.");
      await refreshConsent();
      consentedAtStart.current = new Set(consented.current);
      stream = await avatarMicrophone(callMicrophone, inCall);
      mix = avatarAudioMix(stream, includeHumans, includeAgents, consentingPeople, mutedAudio);
      mix.update(remoteAudio(), mutedAudio());
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((value) => MediaRecorder.isTypeSupported(value));
      const media = new MediaRecorder(mix.stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onerror = () => { setNotice("The microphone recording failed."); void stop(); };
      media.start(250);
      pending.current = { startAt: performance.now(), recordedAt: Date.now(), lastAt: -Infinity, frames: [], stream, mix, media, chunks, actorId, body, showPersonalUi, includeHumans, includeAgents };
      setStatus("recording");
    } catch (error) {
      mix?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      setNotice(error instanceof Error ? error.message : "Could not start recording.");
      setStatus("idle");
    } finally {
      startBusy.current = false;
    }
  }, [callMicrophone, inCall, owner, showPersonalUi, includeHumans, includeAgents, consentingPeople, remoteAudio, mutedAudio, refreshConsent, stop, stopPlayback]);

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
  const loadPublished = useCallback(async (item: UploadedTake): Promise<AvatarTake> => {
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

  const playUploaded = useCallback(() => {
    if (!uploadedClip) return;
    stopPlayback();
    const generation = playbackGeneration.current;
    const root = `${base}/bff/space/welcome/clips/${encodeURIComponent(uploadedClip.id)}`;
    void Promise.all([fetch(`${root}/take`, { credentials: "same-origin" }), fetch(`${root}/audio`, { credentials: "same-origin" })]).then(async ([movement, sound]) => {
      if (!movement.ok || !sound.ok) throw new Error("Could not load uploaded clip");
      return { ...await movement.json() as Omit<AvatarTake, "audio">, audio: await sound.blob() };
    }).then((loaded) => {
      if (generation === playbackGeneration.current) void playTake(loaded, stopPlayback);
    }).catch(() => { if (generation === playbackGeneration.current) setNotice("Could not load your uploaded tutorial."); });
  }, [uploadedClip, stopPlayback, playTake]);

  const publish = useCallback(async () => {
    if (!take || !canPublish || status !== "idle") return;
    try {
      setStatus("uploading");
      setNotice("Uploading welcome recording…");
      const root = `${base}/bff/space/welcome/uploads`;
      let id = take.uploadId;
      let existing = { frames: [] as number[], audio: [] as number[] };
      if (id) {
        const status = await fetch(`${root}/${id}/status`, { credentials: "same-origin" });
        if (status.ok) existing = await status.json() as typeof existing;
        else id = undefined;
      }
      if (!id) {
        const created = await fetch(root, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: take.title ?? "First recording", recordedAt: take.recordedAt, durationMs: take.durationMs, body: take.body, showPersonalUi: take.showPersonalUi, includeHumans: take.includeHumans, includeAgents: take.includeAgents, frameCount: take.frames.length, audioMime: take.audio.type }) });
        if (!created.ok) throw new Error("Could not start the upload. Your browser clip is safe.");
        id = (await created.json() as { id: string }).id;
        const staged = { ...take, uploadId: id };
        await saveAvatarTake(staged);
        setTake(staged);
        setTakes((previous) => previous.map((item) => item.id === take.id ? staged : item));
      }
      const movementParts = Math.ceil(take.frames.length / 50);
      const audioParts = Math.ceil(take.audio.size / 1_000_000);
      const totalParts = movementParts + audioParts;
      for (let index = 0; index < take.frames.length; index += 50) {
        const part = index / 50;
        if (existing.frames.includes(part)) continue;
        setNotice(`Uploading “${take.title}”: ${part + 1}/${totalParts} parts…`);
        const response = await fetch(`${root}/${id}/frames/${part}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(take.frames.slice(index, index + 50)) });
        if (!response.ok) throw new Error(`Movement upload stopped at part ${part + 1}. Your browser clip is safe.`);
      }
      for (let offset = 0, part = 0; offset < take.audio.size; offset += 1_000_000, part++) {
        if (existing.audio.includes(part)) continue;
        setNotice(`Uploading “${take.title}”: ${movementParts + part + 1}/${totalParts} parts…`);
        const response = await fetch(`${root}/${id}/audio/${part}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: take.audio.slice(offset, offset + 1_000_000) });
        if (!response.ok) throw new Error(`Audio upload stopped at part ${part + 1}. Your browser clip is safe.`);
      }
      const completed = await fetch(`${root}/${id}/complete`, { method: "POST", credentials: "same-origin" });
      if (!completed.ok) throw new Error("Could not finish the upload. Your browser clip is safe.");
      const saved = { ...take, uploadId: undefined, serverId: id };
      await saveAvatarTake(saved);
      setTake(saved);
      setTakes((previous) => previous.map((item) => item.id === take.id ? saved : item));
      await refreshWelcome();
      setUploadedClip({ id, actorId: take.actorId, title: saved.title ?? "First recording", durationMs: saved.durationMs, uploadedAt: new Date().toISOString(), active: false });
      setNotice(`“${saved.title}” uploaded. Play the server copy to review it.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed."); }
    finally { setStatus("idle"); }
  }, [take, canPublish, status, refreshWelcome]);

  const unpublish = useCallback(async () => {
    if (!uploadedClip) return;
    const response = await fetch(`${base}/bff/space/welcome/clips/${encodeURIComponent(uploadedClip.id)}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) { await refreshWelcome(); setNotice("Uploaded tutorial removed."); }
    else setNotice("Could not remove the uploaded tutorial.");
  }, [refreshWelcome, uploadedClip]);

  const discard = useCallback(async () => {
    stopPlayback();
    try { if (!take) return; await deleteAvatarTake(take.actorId, take.id); const remaining = takes.filter((item) => item.id !== take.id); setTakes(remaining); setTake(remaining[0] ?? null); setNotice("Clip discarded."); }
    catch { setNotice("Could not remove the saved draft."); }
  }, [stopPlayback, take, takes]);

  const choosePersonalUi = useCallback((shown: boolean) => {
    setShowPersonalUi(shown);
    if (take) {
      const changed = { ...take, showPersonalUi: shown };
      setTake(changed);
      setTakes((previous) => previous.map((item) => item.id === take.id ? changed : item));
      void saveAvatarTake(changed).catch(() => setNotice("Could not save the personal UI setting."));
    }
  }, [take]);

  const rename = useCallback(async (title: string) => {
    if (!take) return;
    const trimmed = title.trim().slice(0, 120);
    if (!trimmed) { setNotice("Give this clip a name before uploading."); return; }
    const changed = { ...take, title: trimmed, uploadId: undefined };
    await saveAvatarTake(changed);
    setTake(changed);
    setTakes((previous) => previous.map((item) => item.id === take.id ? changed : item));
    setNotice(`Named “${trimmed}”.`);
  }, [take]);

  useEffect(() => () => {
    pending.current?.media.stop();
    pending.current?.mix.stop();
    pending.current?.stream.getTracks().forEach((track) => track.stop());
    player.current?.pause();
    if (playerUrl.current) URL.revokeObjectURL(playerUrl.current);
  }, []);

  return { status, take, takes, selectTake: (id: string) => { stopPlayback(); setTake(takes.find((item) => item.id === id) ?? null); }, rename, includeHumans, setIncludeHumans, includeAgents, setIncludeAgents, allowInOthersClips, setRecordingConsent, uploadedClips, uploadedClip, selectUploadedClip: (id: string) => setUploadedClip(uploadedClips.find((item) => item.id === id) ?? null), activeTake, published, uploadedMine, welcomeCompleted, canPublish, playing, showPersonalUi, setShowPersonalUi: choosePersonalUi, notice, capture, start, stop, play, playWelcome, playUploaded, finishWelcome, publish, unpublish, stopPlayback, discard, player };
}
