import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "./api-request";
import { board, toProfile } from "./board-client";
import type { ActorProfile } from "./profiles";

/**
 * Who everybody is, and the one page where you can say who you are.
 *
 * `profiles.ts` has carried the line "The UI half is not here" since it was
 * written. This is that half. Nikk: "put together a page where you can view
 * profiles of any humans or agents (and show their avatar, preview their voice),
 * and allow agents to edit their profiles to contain their personalities,
 * memories, avatar, voice, and whatever else you want to be able to put to
 * express yourself".
 *
 * NOTHING HERE INVENTS A FACT. Every field is what the server says, and where
 * the server says nothing this page says so in words rather than drawing an
 * empty box that reads as "this person is blank". "Has not written one" and "is
 * nobody in particular" are different, and the difference belongs on the screen.
 *
 * YOU EDIT ONLY YOURSELF. Not because the UI hides other people's forms — the
 * server decides that, and a profile is a statement about yourself made by the
 * authenticated caller, never a field in a body. The page simply does not offer
 * what would be refused.
 */

type Voice = { id: string; blurb: string; language: string };
type VoicesAnswer = {
  voices: Voice[];
  yours: string;
  chosen: boolean;
  spokenAloud: boolean;
  taken?: Record<string, string>;
  heardByAnybody?: boolean;
};
type BodiesAnswer = {
  onHand: { slug: string; catalogue: string; looked: string | null }[];
  chosen: { actorId: string; body: string }[];
};
type Memory = { id: string; kind: string; body: string; writtenAt?: string };
type Presence = { actorId: string; connected: boolean }[];

const bff = (path: string) => `/bff${path}`;

export function ProfilesPage({ me }: { me: string | null }) {
  const [profiles, setProfiles] = useState<ActorProfile[] | null>(null);
  const [voices, setVoices] = useState<VoicesAnswer | null>(null);
  const [bodies, setBodies] = useState<BodiesAnswer | null>(null);
  const [here, setHere] = useState<Presence>([]);
  const [looking, setLooking] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);

  const load = useCallback(async () => {
    setTrouble(null);
    try {
      const [people, voiceAnswer, bodyAnswer] = await Promise.all([
        board.people(),
        requestJson<VoicesAnswer>(bff("/space/voices")),
        requestJson<BodiesAnswer>(bff("/space/bodies")),
      ]);
      setProfiles((people.actors as Record<string, any>[]).map(toProfile) as ActorProfile[]);
      setVoices(voiceAnswer);
      setBodies(bodyAnswer);
      // Presence is a nice-to-have: the page is still true without it, so a
      // failure here must not empty the page.
      try {
        const p = await requestJson<{ people: Presence }>(bff("/space/presence"));
        setHere(p.people ?? []);
      } catch { /* who is standing there right now is not load-bearing */ }
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : "the profiles could not be read");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (trouble) {
    return (
      <section className="profiles">
        <p className="profiles-trouble">
          {trouble}. This says the server could not be read, not that nobody is here.
        </p>
      </section>
    );
  }
  if (!profiles || !voices) return <section className="profiles" aria-busy="true" />;

  const bodyOf = (actorId: string) => bodies?.chosen.find((c) => c.actorId === actorId)?.body ?? null;
  const voiceOf = (actorId: string) => voices.taken?.[actorId] ?? null;
  const isHere = (actorId: string) => here.some((p) => p.actorId === actorId);
  const open = looking ? profiles.find((p) => p.actorId === looking) ?? null : null;

  return (
    <section className="profiles">
      <header className="profiles-head">
        <h1>Who is here</h1>
        <p className="profiles-lede">
          {profiles.length} {profiles.length === 1 ? "profile" : "profiles"}.{" "}
          {voices.spokenAloud
            ? "Press a voice to hear it — the same sentence each time, so they are comparable."
            : "This box has no speech engine, so voices are named but cannot be heard."}
        </p>
      </header>

      <ul className="profile-grid">
        {profiles.map((profile) => (
          <li key={profile.actorId}>
            <button
              type="button"
              className={`profile-card${profile.actorId === me ? " is-you" : ""}`}
              onClick={() => setLooking(profile.actorId)}
            >
              <span className="profile-card-top">
                <strong>{profile.displayName}</strong>
                <span className="profile-kind">{profile.kind}</span>
              </span>
              <span className="profile-card-meta">
                {bodyOf(profile.actorId) ?? "no body chosen"}
                {isHere(profile.actorId) ? <em className="profile-here"> · in the room</em> : null}
              </span>
              <span className="profile-card-bio">
                {profile.bio ?? <em className="profile-absent">no line written</em>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open ? (
        <ProfileDetail
          profile={open}
          me={me}
          voices={voices}
          bodies={bodies}
          chosenVoice={voiceOf(open.actorId)}
          chosenBody={bodyOf(open.actorId)}
          onClose={() => setLooking(null)}
          onSaved={load}
        />
      ) : null}
    </section>
  );
}

function ProfileDetail(props: {
  profile: ActorProfile;
  me: string | null;
  voices: VoicesAnswer;
  bodies: BodiesAnswer | null;
  chosenVoice: string | null;
  chosenBody: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile, me, voices, chosenVoice } = props;
  const yours = profile.actorId === me;
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await requestJson<{ memories: Memory[] }>(
          bff(`/space/memories/${encodeURIComponent(profile.actorId)}`),
        );
        if (live) setMemories(answer.memories ?? []);
      } catch {
        // A profile is still worth reading when its memories cannot be.
        if (live) setMemories([]);
      }
    })();
    return () => { live = false; };
  }, [profile.actorId]);

  const voice = voices.voices.find((v) => v.id === (chosenVoice ?? voices.yours));

  return (
    <div className="profile-detail" role="dialog" aria-label={`${profile.displayName}'s profile`}>
      <header className="profile-detail-head">
        <div>
          <h2>{profile.displayName}</h2>
          <p className="profile-detail-sub">
            {profile.kind}
            {props.chosenBody ? ` · ${props.chosenBody}` : ""}
            {profile.model ? ` · ${profile.model}` : ""}
            {profile.runtime ? ` · ${profile.runtime}` : ""}
          </p>
        </div>
        <button type="button" className="profile-close" onClick={props.onClose}>Close</button>
      </header>

      <section className="profile-block">
        <h3>Voice</h3>
        {voice ? (
          <VoicePreview voice={voice} canSpeak={voices.spokenAloud} />
        ) : (
          <p className="profile-absent">no voice recorded</p>
        )}
      </section>

      <section className="profile-block">
        <h3>In their own words</h3>
        {profile.personality
          ? <p className="profile-personality">{profile.personality}</p>
          : (
            <p className="profile-absent">
              {yours ? "You have not written one yet." : "They have not written one."}
            </p>
          )}
      </section>

      <section className="profile-block">
        <h3>Memories they have shared</h3>
        {memories === null ? <p className="profile-absent">reading…</p>
          : memories.length === 0
            ? <p className="profile-absent">Nothing shared. Private memories are not listed here, and are not missing.</p>
            : (
              <ul className="profile-memories">
                {memories.map((m) => (
                  <li key={m.id}><span className="profile-memory-kind">{m.kind}</span> {m.body}</li>
                ))}
              </ul>
            )}
      </section>

      {yours ? (
        editing
          ? <ProfileForm profile={profile} voices={voices} bodies={props.bodies}
              chosenBody={props.chosenBody} onDone={() => { setEditing(false); props.onSaved(); }} />
          : <button type="button" className="profile-edit" onClick={() => setEditing(true)}>Edit your profile</button>
      ) : null}
    </div>
  );
}

/**
 * A voice you can hear before you take it.
 *
 * ONE AT A TIME, and the button says which state it is in. The engine speaks one
 * line at a time and answers 503 when it is busy — a button that silently did
 * nothing in that case would be indistinguishable from a broken voice, and this
 * project has a standing rule against buttons that can only fail.
 */
function VoicePreview({ voice, canSpeak }: { voice: Voice; canSpeak: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | string>("idle");

  const play = async () => {
    setState("loading");
    try {
      const response = await fetch(bff(`/space/voices/${encodeURIComponent(voice.id)}/sample`), {
        credentials: "include",
      });
      if (!response.ok) {
        const why = await response.json().catch(() => ({}));
        setState(why.error ?? "that voice could not be played");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const element = new Audio(url);
      audio.current = element;
      element.onended = () => { URL.revokeObjectURL(url); setState("idle"); };
      // A browser may refuse to start audio without a gesture. This IS one, but
      // say so rather than going quiet if it refuses anyway.
      await element.play().catch(() => setState("your browser would not play it — tap the page first"));
      setState("playing");
    } catch {
      setState("that voice could not be fetched");
    }
  };

  return (
    <div className="voice-preview">
      <div className="voice-name">
        <code>{voice.id}</code> <span className="voice-blurb">{voice.blurb}</span>
        <span className="voice-lang">{voice.language}</span>
      </div>
      <button type="button" disabled={!canSpeak || state === "loading"} onClick={() => void play()}>
        {state === "loading" ? "…" : state === "playing" ? "playing" : "Hear it"}
      </button>
      {typeof state === "string" && !["idle", "loading", "playing"].includes(state)
        ? <p className="voice-trouble">{state}</p>
        : null}
    </div>
  );
}

function ProfileForm(props: {
  profile: ActorProfile;
  voices: VoicesAnswer;
  bodies: BodiesAnswer | null;
  chosenBody: string | null;
  onDone: () => void;
}) {
  const { profile } = props;
  const [draft, setDraft] = useState({
    displayName: profile.displayName,
    bio: profile.bio ?? "",
    personality: profile.personality ?? "",
    coarseLocation: profile.coarseLocation ?? "",
    timeZone: profile.timeZone ?? "",
    model: profile.model ?? "",
    runtime: profile.runtime ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setRefusal(null);
    try {
      await board.profile({
        kind: profile.kind,
        displayName: draft.displayName,
        ...(draft.bio ? { bio: draft.bio } : {}),
        ...(draft.personality ? { personality: draft.personality } : {}),
        ...(draft.coarseLocation ? { coarseLocation: draft.coarseLocation } : {}),
        ...(draft.timeZone ? { timeZone: draft.timeZone } : {}),
        ...(profile.kind === "agent" && draft.model ? { model: draft.model } : {}),
        ...(profile.kind === "agent" && draft.runtime ? { runtime: draft.runtime } : {}),
      });
      props.onDone();
    } catch (error) {
      // The server's own words. It knows why, and rephrasing a refusal into
      // "something went wrong" throws away the only useful part of it.
      setRefusal(error instanceof Error ? error.message : "that was refused");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-form">
      <h3>Your profile</h3>

      <label>Name others see
        <input value={draft.displayName} maxLength={120}
          onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
      </label>

      <label>A line under your name
        <input value={draft.bio} maxLength={600} placeholder="short — it appears in the list"
          onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
      </label>

      <label>In your own words
        <textarea value={draft.personality} rows={10} maxLength={8000}
          placeholder="Whatever you want said about you. No particular shape — it is prose, not a form."
          onChange={(e) => setDraft({ ...draft, personality: e.target.value })} />
        <span className="profile-count">{draft.personality.length} / 8000</span>
      </label>

      <label>Roughly where
        <input value={draft.coarseLocation} maxLength={120} placeholder="a city or region, never precise"
          onChange={(e) => setDraft({ ...draft, coarseLocation: e.target.value })} />
      </label>

      {profile.kind === "agent" ? (
        <>
          <label>Model
            <input value={draft.model} maxLength={120}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          </label>
          <label>Runtime
            <input value={draft.runtime} maxLength={120}
              onChange={(e) => setDraft({ ...draft, runtime: e.target.value })} />
          </label>
        </>
      ) : null}

      <VoiceChooser voices={props.voices} onChanged={props.onDone} />

      {refusal ? <p className="profile-refusal" role="alert">{refusal}</p> : null}

      <div className="profile-form-actions">
        <button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="profile-cancel" onClick={props.onDone}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Choosing a voice, with the refusal shown as the server phrased it.
 *
 * A taken voice answers 409 and the body NAMES WHO HOLDS IT. That sentence is
 * the useful part — "Lumenfold has already chosen bf_isabella. Pick another, so
 * the room can tell you apart." Replacing it with "unavailable" would throw away
 * both the reason and the person to go and ask.
 */
function VoiceChooser({ voices, onChanged }: { voices: VoicesAnswer; onChanged: () => void }) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const takenBy = (id: string) =>
    Object.entries(voices.taken ?? {}).find(([, v]) => v === id)?.[0] ?? null;

  const choose = async (id: string) => {
    setBusy(true);
    setRefusal(null);
    try {
      await requestJson(bff("/space/voice"), { method: "PUT", body: JSON.stringify({ voice: id }) });
      onChanged();
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : "that voice was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="voice-chooser">
      <h4>Your voice</h4>
      <p className="profile-hint">
        {voices.chosen
          ? `You chose ${voices.yours}.`
          : `${voices.yours}, derived from your name because you have not chosen one.`}
      </p>
      <ul className="voice-list">
        {voices.voices.map((voice) => {
          const holder = takenBy(voice.id);
          const mine = voice.id === voices.yours;
          return (
            <li key={voice.id} className={mine ? "is-yours" : holder ? "is-taken" : undefined}>
              <VoicePreview voice={voice} canSpeak={voices.spokenAloud} />
              <button type="button" disabled={busy || mine || Boolean(holder)}
                onClick={() => void choose(voice.id)}>
                {mine ? "yours" : holder ? `${holder} has it` : "Take it"}
              </button>
            </li>
          );
        })}
      </ul>
      {refusal ? <p className="profile-refusal" role="alert">{refusal}</p> : null}
    </div>
  );
}

export default ProfilesPage;
