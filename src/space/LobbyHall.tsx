import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { RoomSummary } from "../../shared/contracts";
import type { WirePerson } from "../../shared/space-wire";
import { ROOM } from "../../shared/space-layout";
import { bodyKey } from "../../shared/avatar-choice";
import { lobbyDoors, splitDoors, wearables, type LobbyDoor, type PublicSpaceDoor, type Wearable } from "../../shared/lobby-hall";
import { DOOR_PANEL } from "../../shared/lobby-panels";
import { bodiesFromCatalogue } from "../profile-view";
import { requestJson } from "../api-request";
import { bff } from "../bff-client";
import { base } from "../router";
import { avatarRecipe } from "../avatar";
import { WristButton } from "./Backdrop";
import { VrmBody } from "./VrmBody";
import { selfPose } from "./self-pose";
import { LobbyWelcome } from "./LobbyWelcome";
import { DoorsPanel, WardrobePanel } from "./LobbyPanels";

/**
 * THE LOBBY AS A FRONT HALL (shared/lobby-hall.ts has Nikk's words and the
 * rules). Drawn in place of the work panels when you stand in the room called
 * `lobby`, facing where people arrive:
 *
 *   ahead      a MIRROR on the wall, like VRChat's (Nikk, 5238: "an actual
 *              like mirror on the wall that shows a mirror image of you as
 *              well as any other humans or agents who are in the room ...
 *              with their movements reversed"). It draws the room again from
 *              the reflected viewpoint, so everybody in it is there, live.
 *   left       the wardrobe, beside the mirror (Nikk, 5324: "so you can
 *              switch avatars while you can still see yourself"): every body
 *              this server can serve, with its picture. A tap puts it on.
 *   right      a big panel of doors, one per room: yours (private ones too)
 *              and every public room on webharness.chat. A tap takes you
 *              there without leaving the headset, joining first if needed.
 *
 * You arrive in the middle of all three, facing the mirror (Immersive, on
 * entering the lobby): people kept arriving behind it (5324).
 *
 * Buttons are the room's own WristButton, so a ray, a hand and a mouse all
 * press them the way they press the settings menu.
 */
/**
 * AN ARC ROUND WHERE PEOPLE ARRIVE: the mirror straight ahead, the wardrobe
 * beside it on the left, the doors on the right, far enough round that
 * neither touches the mirror (at 32 degrees the wardrobe overlapped the
 * doors, 5238).
 */
const around = (degrees: number, metres = 2.5) => ({
  x: ROOM.spawn.x + Math.sin((degrees * Math.PI) / 180) * metres,
  z: ROOM.spawn.z - Math.cos((degrees * Math.PI) / 180) * metres,
});
const DOORS_AT = around(55, 2.6);
/** The welcome and the controls, on the far side of the doors from the mirror (Nikk, 5469). */
const WELCOME_AT = around(102, 2.4);
/** The doors panel hangs with its middle at about chest height, like the settings panel. */
const DOORS = { at: DOORS_AT, middle: 1.32 };
const MIRROR = { at: around(0, 2.7), width: 2.2, height: 2.3, bottom: 0.05 };
/**
 * The layer only the mirror sees: your own body. Your eyes must not see it (in
 * a headset it would sit round your head), and the mirror must. 1 and 2 are
 * three.js's left and right eye; this is well clear of them.
 */
const MIRROR_ONLY = 10;
const WARDROBE = { at: around(-50, 2.4), middle: 1.32 };

/** Turned to face where people arrive, like everything else in the hall. */
const facingSpawn = (x: number, z: number) => Math.atan2(ROOM.spawn.x - x, ROOM.spawn.z - z);

type BodiesAnswer = { ready?: string[]; catalogue?: string; onHand?: { slug: string; catalogue: string | null }[] };

export function LobbyHall({
  you,
  currentRoom,
  roster,
  peopleRef,
  onSwitchRoom,
}: {
  you: string | null;
  currentRoom: string | null;
  /** Who is here and what they wear; re-renders when a body changes. */
  roster: readonly { actorId: string; body?: string | null }[];
  /** Everybody in full, as of the last snapshot. */
  peopleRef: RefObject<WirePerson[]>;
  onSwitchRoom: (roomName: string) => Promise<void>;
}) {
  const [mine, setMine] = useState<RoomSummary[] | null>(null);
  const [open, setOpen] = useState<RoomSummary[] | null>(null);
  const [spaces, setSpaces] = useState<PublicSpaceDoor[] | null>(null);
  const [wardrobe, setWardrobe] = useState<Wearable[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [dressing, setDressing] = useState<string | null>(null);
  const [finished, setFinished] = useState<{ room: string; title: string }[] | null>(null);

  const loadRooms = useCallback((signal?: AbortSignal) => {
    setMine(null);
    setOpen(null);
    bff.rooms(signal).then(setMine).catch(() => { if (!signal?.aborted) setMine([]); });
    bff.publicRooms(signal).then(setOpen).catch(() => { if (!signal?.aborted) setOpen([]); });
    bff.publicSpaces(signal).then((answer) => setSpaces(answer.spaces)).catch(() => { if (!signal?.aborted) setSpaces([]); });
    bff.finishedSpaces(signal).then((answer) => setFinished(answer.spaces)).catch(() => { if (!signal?.aborted) setFinished([]); });
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

  const allDoors = useMemo(() => lobbyDoors(mine, open, currentRoom, spaces), [mine, open, currentRoom, spaces]);
  const split = useMemo(() => splitDoors(allDoors, finished ?? []), [allDoors, finished]);
  const me = you ? roster.find((person) => person.actorId.toLowerCase() === you.toLowerCase()) ?? null : null;
  const worn = me?.body ? bodyKey(me.body) : null;

  const go = (door: LobbyDoor) => {
    if (going || door.kind === "here") return;
    if (door.kind === "space" && door.space) {
      // A space is its own page: ask for a ticket that says who you are there,
      // then go (a headset leaves VR here; the space has its own Enter VR).
      const name = door.space;
      setGoing(door.room);
      setNotice(`Going to ${door.room}…`);
      bff.spaceTicket(name)
        .then((answer) => window.location.assign(`${base}${answer.path}`))
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : `Could not open ${door.room}.`);
          setGoing(null);
        });
      return;
    }
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

  return (
    <group>
      {/* THE DOORS, ahead and to the right of where people arrive: the settings panel's rows (Nikk2, 6974). */}
      <group position={[DOORS.at.x, 0, DOORS.at.z]} rotation={[0, facingSpawn(DOORS.at.x, DOORS.at.z), 0]}>
        <group position={[0, DOORS.middle, 0]}>
          <DoorsPanel split={split} loading={mine === null || open === null} going={going} onGo={go} onRefresh={() => loadRooms()} />
        </group>
        {notice ? (
          <WristButton label={notice} y={DOORS.middle - DOOR_PANEL.height / 2 - 0.1} width={DOOR_PANEL.width} height={0.1} tone="muted" onTap={() => setNotice(null)} />
        ) : null}
      </group>

      {/* THE WELCOME, beside the doors. */}
      <group position={[WELCOME_AT.x, 0, WELCOME_AT.z]} rotation={[0, facingSpawn(WELCOME_AT.x, WELCOME_AT.z), 0]}>
        <LobbyWelcome />
      </group>

      {/* THE MIRROR, and you, drawn for it alone. */}
      <group position={[MIRROR.at.x, 0, MIRROR.at.z]} rotation={[0, facingSpawn(MIRROR.at.x, MIRROR.at.z), 0]}>
        <Mirror />
      </group>
      {me ? <SelfForMirror actorId={me.actorId} body={me.body ?? null} peopleRef={peopleRef} /> : null}

      {/* THE WARDROBE: every body this server can serve, as pictures on the settings panel's paper (Nikk2, 6974). */}
      <group position={[WARDROBE.at.x, WARDROBE.middle, WARDROBE.at.z]} rotation={[0, facingSpawn(WARDROBE.at.x, WARDROBE.at.z), 0]}>
        <WardrobePanel bodies={wardrobe} worn={worn} busy={dressing} onWear={wear} />
      </group>
    </group>
  );
}

/**
 * A mirror on the wall: a frame, and three.js's Reflector, which draws the room
 * again from the viewpoint reflected in the glass, once per eye in a headset.
 * Its cameras also see MIRROR_ONLY, which is how you appear in it.
 *
 * NOT FREE: it draws the room a second time whenever you face it, which is why
 * only the lobby has one, and why its picture is 1024 pixels wide with no
 * multisampling rather than the default.
 */
function Mirror() {
  const reflector = useMemo(() => {
    const glass = new Reflector(new THREE.PlaneGeometry(MIRROR.width, MIRROR.height), {
      textureWidth: 1024,
      textureHeight: Math.round((1024 * MIRROR.height) / MIRROR.width),
      color: 0xc4c8d0,
      multisample: 0,
      clipBias: 0.003,
    });
    const cameraFor = glass.getReflectionCamera.bind(glass);
    glass.getReflectionCamera = (camera) => {
      const reflected = cameraFor(camera);
      reflected.layers.enable(MIRROR_ONLY);
      return reflected;
    };
    return glass;
  }, []);
  useEffect(() => () => {
    reflector.geometry.dispose();
    reflector.dispose();
  }, [reflector]);
  const middle = MIRROR.bottom + MIRROR.height / 2;
  return (
    <group>
      <mesh position={[0, middle, -0.02]} raycast={() => null}>
        <boxGeometry args={[MIRROR.width + 0.1, MIRROR.height + 0.1, 0.03]} />
        <meshStandardMaterial color="#2b2f38" roughness={0.6} metalness={0.3} />
      </mesh>
      <primitive object={reflector} position={[0, middle, 0]} />
    </group>
  );
}

/**
 * YOU, AS THE MIRROR SEES YOU: your body, where you are, moving as you move.
 *
 * In a headset it follows what the headset measured THIS frame (self-pose.ts),
 * head and both hands, fingers as last read; in a window, where you are and
 * which way you face, idling. Drawn only on MIRROR_ONLY, so nobody sees it
 * but the mirror, and it never snaps behind or eases: it is you.
 */
function SelfForMirror({
  actorId,
  body,
  peopleRef,
}: {
  actorId: string;
  body: string | null;
  peopleRef: RefObject<WirePerson[]>;
}) {
  const recipe = useMemo(() => avatarRecipe(actorId), [actorId]);
  const camera = useThree((state) => state.camera);
  const holder = useRef<THREE.Group>(null);
  const scratch = useMemo(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YXZ") }), []);
  const live = useCallback((): WirePerson | null => {
    const person = peopleRef.current?.find((one) => one.actorId === actorId);
    if (!person) return null;
    const head = selfPose.head;
    if (head) {
      scratch.q.set(head.q.x, head.q.y, head.q.z, head.q.w);
      scratch.e.setFromQuaternion(scratch.q, "YXZ");
      const hand = (side: "left" | "right") => {
        const pose = selfPose.hands[side];
        const f = selfPose.fingers[side];
        return pose ? (f ? { ...pose, f: [...f] } : pose) : null;
      };
      return {
        ...person,
        at: { x: head.p.x, y: 0, z: head.p.z },
        facing: scratch.e.y,
        head,
        hands: { left: hand("left"), right: hand("right") },
        moving: false,
      };
    }
    camera.getWorldPosition(scratch.p);
    camera.getWorldQuaternion(scratch.q);
    scratch.e.setFromQuaternion(scratch.q, "YXZ");
    return {
      ...person,
      at: { x: scratch.p.x, y: 0, z: scratch.p.z },
      facing: scratch.e.y,
      head: null,
      hands: { left: null, right: null },
      moving: false,
    };
  }, [actorId, camera, peopleRef, scratch]);
  // For the mirror alone. Set every frame because the model loads, and is
  // replaced, after this mounts; setting a mask that is already set is free.
  useFrame(() => {
    holder.current?.traverse((part) => {
      if (part.layers.mask !== 1 << MIRROR_ONLY) part.layers.set(MIRROR_ONLY);
    });
  });
  const [failed, setFailed] = useState(false);
  const onFailed = useCallback(() => setFailed(true), []);
  useEffect(() => setFailed(false), [body]);
  if (failed) return null;
  return (
    <group ref={holder}>
      <VrmBody
        actorId={actorId}
        body={body}
        live={live}
        recipe={recipe}
        // Never eased, because a reflection that trails you is not one, but
        // with the feet still stepping (Nikk, 5289: "you don't see your own
        // legs moving").
        reducedMotion={false}
        exact
        onFailed={onFailed}
        speaking={false}
        agent={false}
      />
    </group>
  );
}
