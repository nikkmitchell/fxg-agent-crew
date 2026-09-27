import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";
import type { RoomSummary } from "../../shared/contracts";
import type { WirePerson } from "../../shared/space-wire";
import { ROOM } from "../../shared/space-layout";
import { bodyKey, thumbPath } from "../../shared/avatar-choice";
import { lobbyDoors, pageOf, wearables, type LobbyDoor, type Wearable } from "../../shared/lobby-hall";
import { bodiesFromCatalogue } from "../profile-view";
import { requestJson } from "../api-request";
import { bff } from "../bff-client";
import { base } from "../router";
import { avatarRecipe } from "../avatar";
import { WristButton } from "./Backdrop";
import { VrmBody } from "./VrmBody";

/**
 * THE LOBBY AS A FRONT HALL (shared/lobby-hall.ts has Nikk's words and the
 * rules). Drawn in place of the work panels when you stand in the room called
 * `lobby`, facing where people arrive:
 *
 *   ahead      a big panel of doors, one per room: yours (private ones too)
 *              and every public room on webharness.chat. A tap takes you
 *              there without leaving the headset, joining first if needed.
 *   left       you, as everybody else sees you, idling on the spot.
 *   right      the wardrobe: every body this server can serve, with its
 *              picture. A tap puts it on, and the figure on the left changes.
 *
 * Buttons are the room's own WristButton, so a ray, a hand and a mouse all
 * press them the way they press the settings menu.
 */
/**
 * AN ARC 2.5 m FROM WHERE PEOPLE ARRIVE: the doors straight ahead, you 32
 * degrees to the left, the wardrobe 32 to the right, so a window's view and
 * a headset's glance both take in all three.
 */
const around = (degrees: number, metres = 2.5) => ({
  x: ROOM.spawn.x + Math.sin((degrees * Math.PI) / 180) * metres,
  z: ROOM.spawn.z - Math.cos((degrees * Math.PI) / 180) * metres,
});
const DOORS = { at: [ROOM.spawn.x, 0, ROOM.spawn.z - 2.5] as const, columns: 4, rows: 2, width: 0.52, height: 0.56, gap: 0.08, top: 1.72 };
const FIGURE_AT = around(-32);
const WARDROBE = { at: around(32), columns: 4, rows: 3, thumb: { width: 0.16, height: 0.24 }, top: 1.86 };

/** Turned to face where people arrive, like everything else in the hall. */
const facingSpawn = (x: number, z: number) => Math.atan2(ROOM.spawn.x - x, ROOM.spawn.z - z);

type BodiesAnswer = { ready?: string[]; catalogue?: string; onHand?: { slug: string; catalogue: string | null }[] };

export function LobbyHall({
  you,
  currentRoom,
  roster,
  peopleRef,
  reducedMotion,
  onSwitchRoom,
}: {
  you: string | null;
  currentRoom: string | null;
  /** Who is here and what they wear; re-renders when a body changes. */
  roster: readonly { actorId: string; body?: string | null }[];
  /** Everybody in full, as of the last snapshot. */
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
  onSwitchRoom: (roomName: string) => Promise<void>;
}) {
  const [mine, setMine] = useState<RoomSummary[] | null>(null);
  const [open, setOpen] = useState<RoomSummary[] | null>(null);
  const [wardrobe, setWardrobe] = useState<Wearable[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [dressing, setDressing] = useState<string | null>(null);
  const [doorPage, setDoorPage] = useState(0);
  const [bodyPage, setBodyPage] = useState(0);

  const loadRooms = useCallback((signal?: AbortSignal) => {
    setMine(null);
    setOpen(null);
    bff.rooms(signal).then(setMine).catch(() => { if (!signal?.aborted) setMine([]); });
    bff.publicRooms(signal).then(setOpen).catch(() => { if (!signal?.aborted) setOpen([]); });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadRooms(controller.signal);
    // The wardrobe: what this server can serve, named from the catalogue.
    void (async () => {
      try {
        const answer = await requestJson<BodiesAnswer>(`${base}/bff/space/bodies`, { signal: controller.signal });
        const catalogue = answer.catalogue
          ? bodiesFromCatalogue(await requestJson<unknown>(`${base}${answer.catalogue}`, { signal: controller.signal }))
          : [];
        setWardrobe(wearables(answer.ready ?? [], catalogue, answer.onHand ?? []));
      } catch {
        if (!controller.signal.aborted) setWardrobe([]);
      }
    })();
    return () => controller.abort();
  }, [loadRooms]);

  const doors = useMemo(() => lobbyDoors(mine, open, currentRoom), [mine, open, currentRoom]);
  const doorsShown = pageOf(doors, DOORS.columns * DOORS.rows, doorPage);
  const me = you ? roster.find((person) => person.actorId.toLowerCase() === you.toLowerCase()) ?? null : null;
  const worn = me?.body ? bodyKey(me.body) : null;
  const bodiesShown = pageOf(wardrobe ?? [], WARDROBE.columns * WARDROBE.rows, bodyPage);

  const go = (door: LobbyDoor) => {
    if (going || door.kind === "here") return;
    setGoing(door.room);
    setNotice(door.kind === "join" ? `Joining ${door.room}…` : `Going to ${door.room}…`);
    (door.kind === "join" ? bff.joinRoom(door.room).then(() => onSwitchRoom(door.room)) : onSwitchRoom(door.room))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `Could not go to ${door.room}.`))
      .finally(() => setGoing(null));
  };

  const wear = (body: Wearable) => {
    if (dressing || body.key === worn) return;
    setDressing(body.key);
    setNotice(`Putting on ${body.name}…`);
    requestJson(`${base}/bff/space/body`, { method: "PUT", body: JSON.stringify({ body: body.key }) })
      .then(() => setNotice(`You are wearing ${body.name}`))
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `${body.name} could not be worn.`))
      .finally(() => setDressing(null));
  };

  const doorsTitle = mine === null || open === null ? "Rooms · finding them…" : `Rooms · ${doors.length} · tap a door to go`;
  return (
    <group>
      {/* THE DOORS, straight ahead of where people arrive. */}
      <group position={[...DOORS.at]}>
        <WristButton label={doorsTitle} y={DOORS.top + 0.44} width={2.2} height={0.12} tone="muted" onTap={() => {}} />
        {doorsShown.items.map((door, index) => {
          const column = index % DOORS.columns;
          const row = Math.floor(index / DOORS.columns);
          const action = door.kind === "here" ? "you are here" : door.kind === "join" ? "JOIN + ENTER" : "ENTER";
          return (
            <WristButton
              key={door.room}
              label={`${going === door.room ? "…" : ""}${door.room}\n${door.detail || " "}\n${action}`}
              x={(column - (DOORS.columns - 1) / 2) * (DOORS.width + DOORS.gap)}
              y={DOORS.top - row * (DOORS.height + DOORS.gap)}
              width={DOORS.width}
              height={DOORS.height}
              lines={4}
              tone={door.kind === "here" ? "live" : door.kind === "join" ? "muted" : "normal"}
              onTap={() => go(door)}
            />
          );
        })}
        <Pager
          y={DOORS.top - DOORS.rows * (DOORS.height + DOORS.gap) + 0.12}
          page={doorsShown.page}
          pages={doorsShown.pages}
          onPage={setDoorPage}
          extra={{ label: "↻ refresh", onTap: () => { setDoorPage(0); loadRooms(); } }}
        />
        {notice ? <WristButton label={notice} y={0.28} width={2.2} height={0.1} tone="muted" onTap={() => setNotice(null)} /> : null}
      </group>

      {/* YOU, as everybody else sees you. */}
      <group position={[FIGURE_AT.x, 0, FIGURE_AT.z]} rotation={[0, facingSpawn(FIGURE_AT.x, FIGURE_AT.z), 0]}>
        {me ? <Figure actorId={me.actorId} body={me.body ?? null} peopleRef={peopleRef} reducedMotion={reducedMotion} /> : null}
        <WristButton label={me ? `You${me.body ? ` · ${me.body}` : ""}` : "You"} y={2.05} width={0.8} height={0.1} tone="muted" onTap={() => {}} />
      </group>

      {/* THE WARDROBE: every body this server can serve. */}
      <group position={[WARDROBE.at.x, 0, WARDROBE.at.z]} rotation={[0, facingSpawn(WARDROBE.at.x, WARDROBE.at.z), 0]}>
        <WristButton
          label={wardrobe === null ? "Your avatar · loading…" : `Your avatar · ${wardrobe.length} · tap one to wear it`}
          y={WARDROBE.top + 0.3}
          width={1.05}
          height={0.1}
          tone="muted"
          onTap={() => {}}
        />
        {bodiesShown.items.map((body, index) => {
          const column = index % WARDROBE.columns;
          const row = Math.floor(index / WARDROBE.columns);
          return (
            <BodyTile
              key={body.key}
              body={body}
              x={(column - (WARDROBE.columns - 1) / 2) * 0.235}
              y={WARDROBE.top - row * 0.37}
              worn={body.key === worn}
              busy={dressing === body.key}
              onWear={() => wear(body)}
            />
          );
        })}
        <Pager y={WARDROBE.top - WARDROBE.rows * 0.37 + 0.1} page={bodiesShown.page} pages={bodiesShown.pages} onPage={setBodyPage} />
      </group>
    </group>
  );
}

/** Back, where you are, forward; and one more button when a list wants it. */
function Pager({
  y,
  page,
  pages,
  onPage,
  extra,
}: {
  y: number;
  page: number;
  pages: number;
  onPage: (page: number) => void;
  extra?: { label: string; onTap: () => void };
}) {
  return (
    <group>
      <WristButton label="‹" glyph x={-0.34} y={y} width={0.14} height={0.1} tone={page > 0 ? "normal" : "muted"} onTap={() => onPage(Math.max(0, page - 1))} />
      <WristButton label={`${page + 1} of ${pages}`} x={0} y={y} width={0.4} height={0.1} tone="muted" onTap={() => {}} />
      <WristButton label="›" glyph x={0.34} y={y} width={0.14} height={0.1} tone={page < pages - 1 ? "normal" : "muted"} onTap={() => onPage(Math.min(pages - 1, page + 1))} />
      {extra ? <WristButton label={extra.label} x={0.72} y={y} width={0.3} height={0.1} onTap={extra.onTap} /> : null}
    </group>
  );
}

/** One body in the wardrobe: its picture, its name, a ring when you wear it. */
function BodyTile({
  body,
  x,
  y,
  worn,
  busy,
  onWear,
}: {
  body: Wearable;
  x: number;
  y: number;
  worn: boolean;
  busy: boolean;
  onWear: () => void;
}) {
  const picture = useThumb(body.pictured ? `${base}${thumbPath(body.name)}` : null);
  const { width, height } = WARDROBE.thumb;
  return (
    <group position={[x, y, 0]}>
      {worn ? (
        <mesh position={[0, 0, -0.002]} raycast={() => null}>
          <planeGeometry args={[width + 0.024, height + 0.024]} />
          <meshBasicMaterial color="#5b74c4" />
        </mesh>
      ) : null}
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onWear();
        }}
      >
        <planeGeometry args={[width, height]} />
        {/* A NEW MATERIAL WHEN THE PICTURE ARRIVES: three.js compiles a
          material once, and one made without a map stays mapless (black)
          when a map is set on it later. */}
        {picture
          ? <meshBasicMaterial key={picture.uuid} map={picture} toneMapped={false} />
          : <meshBasicMaterial key="none" color="#252a35" />}
      </mesh>
      <WristButton
        label={busy ? "…" : body.name}
        y={-height / 2 - 0.035}
        width={0.22}
        height={0.05}
        lines={1}
        textSize={0.55}
        tone={worn ? "live" : "normal"}
        onTap={onWear}
      />
    </group>
  );
}

/** A picture as a texture, freed when the tile goes (a page turn frees twelve). */
function useThumb(url: string | null): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (made) => {
      made.colorSpace = THREE.SRGBColorSpace;
      if (alive) {
        loaded = made;
        setTexture(made);
      } else {
        made.dispose();
      }
    });
    return () => {
      alive = false;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url]);
  return texture;
}

/**
 * You, standing still: the body you wear, idling, with no head or hands
 * reported, so it moves the way an untracked person does rather than copying
 * your headset from two metres away.
 */
function Figure({
  actorId,
  body,
  peopleRef,
  reducedMotion,
}: {
  actorId: string;
  body: string | null;
  peopleRef: RefObject<WirePerson[]>;
  reducedMotion: boolean;
}) {
  const recipe = useMemo(() => avatarRecipe(actorId), [actorId]);
  const live = useCallback((): WirePerson | null => {
    const person = peopleRef.current?.find((one) => one.actorId === actorId);
    if (!person) return null;
    return {
      ...person,
      at: { x: 0, y: 0, z: 0 },
      // The body faces its own -Z; the group turns it to face arrivals.
      facing: Math.PI,
      head: null,
      hands: { left: null, right: null },
      moving: false,
      attending: null,
    };
  }, [actorId, peopleRef]);
  const [failed, setFailed] = useState(false);
  const onFailed = useCallback(() => setFailed(true), []);
  useEffect(() => setFailed(false), [body]);
  if (failed) return null;
  return (
    <VrmBody
      actorId={actorId}
      body={body}
      live={live}
      recipe={recipe}
      reducedMotion={reducedMotion}
      onFailed={onFailed}
      speaking={false}
      agent={false}
    />
  );
}
