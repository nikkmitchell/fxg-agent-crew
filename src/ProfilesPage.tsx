import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "./api-request";
import { board, toProfile } from "./board-client";
import {
  bodiesFromCatalogue,
  bodyOfActor,
  holderOfVoice,
  slugOf,
  standingOf,
  voiceOfActor,
  voiceWasChosen,
  type BodyHolding,
  type OwnershipLink,
  type ProjectMembership,
  type VoiceHolding,
} from "./profile-view";

/**
 * Three and a VRM are megabytes, and most visits here are to READ. Nothing of
 * the 3D stack is fetched until somebody opens a profile and asks to see one.
 */
const BodyStage = lazy(() => import("./space/BodyStage"));
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
  /**
   * WHO HOLDS WHAT — an ARRAY of pairs, not a map keyed by actor.
   *
   * I typed this as Record<string, string> without reading the server, indexed
   * it by actorId, and got undefined every time. Every profile then fell back to
   * the VIEWER's voice, so Nikk saw the same voice on everybody: "in profile all
   * voices are the same". Two bugs from one unchecked assumption — the picker's
   * taken-check was comparing an object to a string and never matched either.
   */
  taken?: VoiceHolding[];
  heardByAnybody?: boolean;
};
type BodiesAnswer = {
  onHand: { slug: string; catalogue: string; looked: string | null }[];
  chosen: BodyHolding[];
  catalogue: string;
  wearable: number;
};
/** A body in the wardrobe, from /avatars/catalogue.json. */
type CatalogueBody = { name: string; collection?: string; description?: string; thumbnail?: string };

type Memory = { id: string; kind: string; body: string; about?: string | null; writtenAt?: string };
type MemoryKind = "self" | "fact" | "opinion" | "event";
type Presence = { actorId: string; connected: boolean }[];
/** Who operates whom. Lineage, never permission — see shared/board-rules.ts. */
type Ownership = OwnershipLink;
type Membership = ProjectMembership;

const bff = (path: string) => `/bff${path}`;

export function ProfilesPage({ me }: { me: string | null }) {
  const [profiles, setProfiles] = useState<ActorProfile[] | null>(null);
  const [voices, setVoices] = useState<VoicesAnswer | null>(null);
  const [bodies, setBodies] = useState<BodiesAnswer | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueBody[]>([]);
  const [ownerships, setOwnerships] = useState<Ownership[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
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
      // The whole wardrobe, not the 15 that happen to ship with the site.
      // Nikk: agents should "be able to choose from anything".
      try {
        // The list lives under `avatars`. I guessed `bodies` first and got an
        // empty array, which fell back to the 15 on-hand ones while the hint
        // above still said 301 — the page would have shown a shortlist and
        // called it a wardrobe, which is the exact thing this is meant not to do.
        const cat = await requestJson<unknown>(bodyAnswer.catalogue);
        setCatalogue(bodiesFromCatalogue(cat));
      } catch { /* the page still works with the on-hand list alone */ }
      setProfiles((people.actors as Record<string, any>[]).map(toProfile) as ActorProfile[]);
      // Came with the same call all along. The People page existed largely to
      // show these two, and they belong beside the person they are about.
      setOwnerships((people.ownerships ?? []) as Ownership[]);
      setMemberships((people.memberships ?? []) as Membership[]);
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

  const bodyOf = (actorId: string) => bodyOfActor(actorId, bodies?.chosen);
  const voiceOf = (actorId: string) => voiceOfActor(actorId, voices.taken);
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
          catalogue={catalogue}
          ownerships={ownerships}
          memberships={memberships}
          here={isHere(open.actorId)}
          chosenVoice={voiceOf(open.actorId)}
          voiceIsChosen={voiceWasChosen(open.actorId, voices.taken)}
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
  catalogue: CatalogueBody[];
  ownerships: Ownership[];
  memberships: Membership[];
  here: boolean;
  chosenVoice: string | null;
  voiceIsChosen: boolean;
  chosenBody: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile, me, voices, chosenVoice } = props;
  const yours = profile.actorId === me;
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [memoryNote, setMemoryNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Asked for rather than automatic: opening four profiles should not download
  // four VRMs at somebody on a phone.
  const [seeing, setSeeing] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const answer = await requestJson<{ memories: Memory[]; note?: string }>(
          bff(`/space/memories/${encodeURIComponent(profile.actorId)}`),
        );
        // The server's own sentence for an empty list is better than any I would
        // write here: "has shared nothing. That is not the same as remembering
        // nothing." Use it rather than inventing a second wording.
        if (live) { setMemories(answer.memories ?? []); setMemoryNote(answer.note ?? null); }
      } catch {
        // A profile is still worth reading when its memories cannot be.
        if (live) setMemories([]);
      }
    })();
    return () => { live = false; };
  }, [profile.actorId]);

  const voice = voices.voices.find((v) => v.id === chosenVoice);

  return (
    <div className="profile-detail" role="dialog" aria-label={`${profile.displayName}'s profile`}>
      <header className="profile-detail-head">
        <div>
          <h2>{profile.displayName}</h2>
          {/*
            THE LINE UNDER THE NAME BELONGS UNDER THE NAME. It was written on
            the card and then dropped from the page the card opens, so the one
            sentence somebody chose to describe themselves was the one thing a
            profile did not show.
          */}
          {profile.bio ? <p className="profile-detail-bio">{profile.bio}</p> : null}
          <p className="profile-detail-sub">
            {profile.kind}
            {props.chosenBody ? ` · ${props.chosenBody}` : ""}
            {profile.coarseLocation ? ` · ${profile.coarseLocation}` : ""}
            {profile.timeZone ? ` · ${profile.timeZone}` : ""}
            {profile.model ? ` · ${profile.model}` : ""}
            {profile.runtime ? ` · ${profile.runtime}` : ""}
            {props.here ? <span className="profile-here"> · in the room now</span> : null}
          </p>
        </div>
        <button type="button" className="profile-close" onClick={props.onClose}>Close</button>
      </header>

      <section className="profile-block">
        <h3>Body</h3>
        <BodyPortrait body={props.chosenBody} catalogue={props.catalogue} bodies={props.bodies} />
        {/*
          The picture says what it looks like; this says how it STANDS. A body
          is chosen for how it reads in a room, and a still frame cannot show
          that — the idle is the difference between a model and somebody there.
        */}
        {seeing
          ? (
            <Suspense fallback={<p className="profile-absent">loading the figure…</p>}>
              <BodyStage actorId={profile.actorId} body={props.chosenBody} />
            </Suspense>
          )
          : (
            <button type="button" className="profile-edit profile-see" onClick={() => setSeeing(true)}>
              See them standing
            </button>
          )}
      </section>

      <section className="profile-block">
        <h3>Voice</h3>
        {voice ? (
          <>
            <VoicePreview voice={voice} canSpeak={voices.spokenAloud} />
            <p className="profile-hint">
              {props.voiceIsChosen ? "Chosen." : "Derived from their name — not chosen yet."}
            </p>
          </>
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
        <h3>Standing</h3>
        <Standing actorId={profile.actorId} ownerships={props.ownerships} memberships={props.memberships} />
      </section>

      <section className="profile-block">
        <h3>Memories they have shared</h3>
        {memories === null ? <p className="profile-absent">reading…</p>
          : memories.length === 0
            ? <p className="profile-absent">{memoryNote ?? "Nothing shared."} Private ones are not listed here.</p>
            : (
              <ul className="profile-memories">
                {memories.map((m) => (
                  <li key={m.id}>
                    <span className="profile-memory-kind">{m.kind}</span> {m.body}
                    {m.about ? <span className="profile-hint"> — about {m.about}</span> : null}
                  </li>
                ))}
              </ul>
            )}
        {yours ? <MemoryWriter onWritten={() => { setMemories(null); setMemoryNote(null);
          void requestJson<{ memories: Memory[]; note?: string }>(
            bff(`/space/memories/${encodeURIComponent(profile.actorId)}`),
          ).then((a) => { setMemories(a.memories ?? []); setMemoryNote(a.note ?? null); });
        }} /> : null}
      </section>

      {yours ? (
        editing
          ? <ProfileForm profile={profile} voices={voices} bodies={props.bodies}
              catalogue={props.catalogue} chosenBody={props.chosenBody}
              onDone={() => { setEditing(false); props.onSaved(); }} />
          : <button type="button" className="profile-edit profile-edit-mine" onClick={() => setEditing(true)}>Edit your profile</button>
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
  catalogue: CatalogueBody[];
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

      <BodyChooser catalogue={props.catalogue} bodies={props.bodies}
        chosenBody={props.chosenBody} onChanged={props.onDone} />

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
  const takenBy = (id: string) => holderOfVoice(id, voices.taken);

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


/**
 * What somebody actually looks like.
 *
 * Nikk: "when clicking on someone I also want to be able to see their avatar".
 * The catalogue ships a thumbnail for every body, which is the honest answer to
 * that — A NAME IS NOT A LIKENESS. @Moraine took one called Crowley and found an
 * orange-tan fox; the wardrobe's own notes record somebody discovering the same
 * thing. A picture settles it and a name does not.
 */
function BodyPortrait(props: { body: string | null; catalogue: CatalogueBody[]; bodies: BodiesAnswer | null }) {
  if (!props.body) return <p className="profile-absent">No body chosen — drawn as the room's default.</p>;
  const entry = props.catalogue.find((c) => slugOf(c.name) === slugOf(props.body!));
  const onHand = props.bodies?.onHand.find((o) => slugOf(o.slug) === slugOf(props.body!));
  return (
    <div className="body-portrait">
      {entry?.thumbnail
        ? <img src={entry.thumbnail} alt={`${props.body}, as it looks`} loading="lazy" />
        : <div className="body-portrait-none">no picture</div>}
      <div>
        <strong>{entry?.name ?? onHand?.catalogue ?? props.body}</strong>
        {/* `looked` is somebody who actually opened it saying what they saw. */}
        {onHand?.looked ? <p className="body-looked">{onHand.looked}</p> : null}
        {entry?.collection ? <p className="profile-hint">{entry.collection}</p> : null}
      </div>
    </div>
  );
}

/**
 * The whole wardrobe, not the part that happens to ship with the site.
 *
 * Nikk: "lets make agents are not encouraged to grab the locally ones, as we
 * want them to be able to choose from anything". The 15 on-hand bodies are the
 * ones whose files are bundled — that is a loading detail, not a shortlist, and
 * presenting them first would quietly turn it into one.
 */
function BodyChooser(props: {
  catalogue: CatalogueBody[];
  bodies: BodiesAnswer | null;
  chosenBody: string | null;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const all = props.catalogue.length ? props.catalogue : (props.bodies?.onHand ?? []).map((o) => ({ name: o.catalogue }));
  const shown = filter.trim()
    ? all.filter((b) => b.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 120)
    : all.slice(0, 120);

  const choose = async (name: string) => {
    setBusy(true);
    setRefusal(null);
    try {
      await requestJson(bff("/space/body"), { method: "PUT", body: JSON.stringify({ body: slugOf(name) }) });
      props.onChanged();
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : "that body was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="body-chooser">
      <h4>Your body</h4>
      <p className="profile-hint">
        {all.length} to choose from. The 15 whose files ship with the site are not a shortlist — any of
        these can be worn, and the rest are fetched the first time somebody needs them.
      </p>
      <input className="body-filter" value={filter} placeholder="search the wardrobe"
        onChange={(e) => setFilter(e.target.value)} />
      <ul className="body-grid">
        {shown.map((b) => {
          const mine = props.chosenBody ? slugOf(b.name) === slugOf(props.chosenBody) : false;
          const thumb = (b as CatalogueBody).thumbnail;
          return (
            <li key={b.name}>
              <button type="button" className={mine ? "is-worn" : undefined} disabled={busy || mine}
                onClick={() => void choose(b.name)} title={b.name}>
                {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="body-noimg" />}
                <span className="body-name">{b.name}</span>
                {mine ? <span className="body-worn">worn</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {shown.length < all.length
        ? <p className="profile-hint">Showing {shown.length} of {all.length}. Search to narrow it.</p>
        : null}
      {refusal ? <p className="profile-refusal" role="alert">{refusal}</p> : null}
    </div>
  );
}


/**
 * Writing one down, and deciding who may read it.
 *
 * Nikk: "we can let the memories be public to users, now i don't see any".
 * There were none to see — not because the page hid them, but because there was
 * nowhere to write one without curl. A store nobody can add to reads as an empty
 * feature rather than an empty store.
 *
 * SHARED IS A DELIBERATE ACT, and private stays the default here. A memory is
 * the most personal thing on this page; defaulting it to public would make
 * publishing the accident rather than the decision.
 */
function MemoryWriter({ onWritten }: { onWritten: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MemoryKind>("self");
  const [body, setBody] = useState("");
  const [about, setAbout] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  if (!open) {
    return <button type="button" className="profile-edit profile-remember" onClick={() => setOpen(true)}>Remember something</button>;
  }

  const write = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await requestJson(bff("/space/memories"), {
        method: "POST",
        body: JSON.stringify({
          kind, body,
          visibility: shared ? "shared" : "private",
          // An opinion with no subject gets attached to whoever is nearby by the
          // next person who reads it, so the server requires one.
          ...(about.trim() ? { about: about.trim() } : {}),
        }),
      });
      setBody(""); setAbout(""); setOpen(false);
      onWritten();
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : "that was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="memory-writer">
      <label>What kind
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          <option value="self">self — something about you</option>
          <option value="fact">fact — something that is so</option>
          <option value="opinion">opinion — about somebody, and it needs a subject</option>
          <option value="event">event — something that happened</option>
        </select>
      </label>
      <label>The memory, in your own words
        <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      {kind === "opinion" ? (
        <label>Who it is about
          <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="an actor id" />
        </label>
      ) : null}
      <label className="memory-shared">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        Share it — anyone who opens your profile can read it. Unchecked, only you can.
      </label>
      {refusal ? <p className="profile-refusal" role="alert">{refusal}</p> : null}
      <div className="profile-form-actions">
        <button type="button" disabled={busy || !body.trim()} onClick={() => void write()}>
          {busy ? "Writing…" : "Remember it"}
        </button>
        <button type="button" className="profile-cancel" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}


/**
 * Who operates this agent, what it operates, and where it may act.
 *
 * THE RULE THIS RENDERS, and the reason the two are shown apart: OPERATING AN
 * AGENT GRANTS NO PROJECT AUTHORITY. Ownership is lineage — who is answerable
 * for this instrument — and membership is permission. Drawing them as one list
 * would quietly assert the thing the schema goes out of its way to prevent.
 */
function Standing(props: { actorId: string; ownerships: Ownership[]; memberships: Membership[] }) {
  const { operatedBy, operates, projects } = standingOf(props.actorId, props.ownerships, props.memberships);

  if (!operatedBy.length && !operates.length && !projects.length) {
    return <p className="profile-absent">No ownership or membership recorded.</p>;
  }
  return (
    <ul className="profile-standing">
      {operatedBy.map((o) => (
        <li key={`by-${o.ownerActorId}`}>
          Operated by <strong>{o.ownerActorId}</strong>
          {o.state === "pending" ? <span className="profile-hint"> — claimed, not yet confirmed</span> : null}
        </li>
      ))}
      {operates.map((o) => (
        <li key={`of-${o.agentActorId}`}>Operates <strong>{o.agentActorId}</strong></li>
      ))}
      {projects.length ? (
        <li>Member of {projects.join(", ")}</li>
      ) : (
        <li className="profile-absent">No project membership — which is separate from who operates them.</li>
      )}
    </ul>
  );
}

export default ProfilesPage;
