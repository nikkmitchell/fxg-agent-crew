import { useCallback, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DEFAULT_AVATAR_STATE } from "../../shared/avatar-motion";
import type { WirePerson } from "../../shared/space-wire";
import { avatarRecipe } from "../avatar";
import { frameAt, type AvatarFrame, type AvatarTake, type RecordedControl, type RecordedPerson } from "./avatar-recording";
import type { AvatarRecorder } from "./useAvatarRecorder";
import { VrmBody } from "./VrmBody";
import { WristButton } from "./Backdrop";
import { ROOM } from "../../shared/space-layout";

/** Put the first measured head in front of arrivals, facing them. */
export function stagedFrames(frames: readonly AvatarFrame[]): AvatarFrame[] {
  const first = frames[0]?.head;
  if (!first) return [];
  const firstQ = new THREE.Quaternion(first.q.x, first.q.y, first.q.z, first.q.w);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(firstQ);
  const firstYaw = Math.atan2(-forward.x, -forward.z);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - firstYaw);
  const vector = new THREE.Vector3();
  const turn = (pose: RecordedControl): RecordedControl => {
    if (!pose) return null;
    vector.set(pose.p.x - first.p.x, pose.p.y, pose.p.z - first.p.z).applyQuaternion(rotation);
    const q = pose.q ? rotation.clone().multiply(new THREE.Quaternion(pose.q.x, pose.q.y, pose.q.z, pose.q.w)) : null;
    return {
      p: { x: ROOM.spawn.x + vector.x, y: vector.y, z: ROOM.spawn.z - 1.5 + vector.z },
      ...(q ? { q: { x: q.x, y: q.y, z: q.z, w: q.w } } : {}),
    };
  };
  return frames.map((frame) => ({
    ...frame,
    head: turn(frame.head) as AvatarFrame["head"],
    hands: {
      left: frame.hands.left ? { ...turn(frame.hands.left)!, ...(frame.hands.left.f ? { f: frame.hands.left.f } : {}) } as AvatarFrame["hands"]["left"] : null,
      right: frame.hands.right ? { ...turn(frame.hands.right)!, ...(frame.hands.right.f ? { f: frame.hands.right.f } : {}) } as AvatarFrame["hands"]["right"] : null,
    },
    balls: {
      left: turn(frame.balls.left),
      leftShadow: turn(frame.balls.leftShadow),
      right: turn(frame.balls.right),
      rightShadow: turn(frame.balls.rightShadow),
    },
    micBar: turn(frame.micBar),
    personalUi: turn(frame.personalUi),
    others: frame.others?.map((person) => ({ ...person, head: turn(person.head) as RecordedPerson["head"], hands: { left: person.hands.left ? { ...turn(person.hands.left)!, ...(person.hands.left.f ? { f: person.hands.left.f } : {}) } as RecordedPerson["hands"]["left"] : null, right: person.hands.right ? { ...turn(person.hands.right)!, ...(person.hands.right.f ? { f: person.hands.right.f } : {}) } as RecordedPerson["hands"]["right"] : null } })),
  }));
}

function Control({ sample, kind }: { sample: () => RecordedControl; kind: "left" | "right" | "shadow" | "mic" | "ui" }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    const node = group.current;
    if (!node) return;
    const pose = sample();
    node.visible = pose !== null;
    if (!pose) return;
    node.position.set(pose.p.x, pose.p.y, pose.p.z);
    if (pose.q) node.quaternion.set(pose.q.x, pose.q.y, pose.q.z, pose.q.w);
    else node.quaternion.identity();
  });
  return (
    <group ref={group} visible={false}>
      {kind === "ui" ? (
        <WristButton label="Personal UI · recorded" y={0} width={0.43} height={0.1} tone="muted" onTap={() => {}} />
      ) : kind === "mic" ? (
        <>
          <mesh raycast={() => null}><boxGeometry args={[0.014, 0.075, 0.014]} /><meshBasicMaterial color="#6fdc8c" transparent opacity={0.9} depthTest={false} /></mesh>
          <mesh raycast={() => null}><boxGeometry args={[0.018, 0.079, 0.018]} /><meshBasicMaterial color="white" transparent opacity={0.25} depthTest={false} wireframe /></mesh>
        </>
      ) : (
        <mesh raycast={() => null}>
          <sphereGeometry args={[0.022, 20, 14]} />
          <meshBasicMaterial color={kind === "left" ? "#7cc4ff" : kind === "right" ? "#ffb86b" : "#ffffff"} transparent opacity={kind === "shadow" ? 0.25 : 0.9} depthTest={false} wireframe={kind === "shadow"} />
        </mesh>
      )}
    </group>
  );
}

/** Replays a local draft at its measured world positions, timed from the audio. */
export function AvatarReplay({ recorder }: { recorder: AvatarRecorder }) {
  const take = recorder.activeTake;
  if (!recorder.playing || !take) return null;
  return <PlayingTake take={take} recorder={recorder} />;
}

function PlayingTake({ take, recorder }: { take: AvatarTake; recorder: AvatarRecorder }) {
  const recipe = useMemo(() => avatarRecipe(take.actorId), [take.actorId]);
  const frames = useMemo(() => stagedFrames(take.frames), [take.frames]);
  const others = useMemo(() => {
    const found = new Map<string, RecordedPerson>();
    for (const frame of frames) for (const person of frame.others ?? []) found.set(person.actorId, person);
    return [...found.values()];
  }, [frames]);
  const [failed, setFailed] = useState(false);
  const current = useRef<AvatarFrame | null>(frames[0] ?? null);
  const refresh = useCallback(() => {
    current.current = frameAt(frames, (recorder.player.current?.currentTime ?? 0) * 1000);
    return current.current;
  }, [frames, recorder.player]);
  const live = useCallback((): WirePerson | null => {
    const frame = refresh();
    if (!frame) return null;
    const head = frame.head;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(head.q.x, head.q.y, head.q.z, head.q.w));
    return {
      actorId: take.actorId,
      kind: "human",
      at: { x: head.p.x, y: 0, z: head.p.z },
      moving: false,
      facing: Math.atan2(-forward.x, -forward.z),
      because: "avatar recording preview",
      connected: true,
      head,
      hands: frame.hands,
      attending: null,
      avatar: DEFAULT_AVATAR_STATE,
      body: take.body,
    };
  }, [refresh, take]);
  const control = useCallback((key: keyof AvatarFrame["balls"]) => () => refresh()?.balls[key] ?? null, [refresh]);
  const mic = useCallback(() => refresh()?.micBar ?? null, [refresh]);
  const ui = useCallback(() => take.showPersonalUi ? refresh()?.personalUi ?? null : null, [refresh, take.showPersonalUi]);
  return (
    <group>
      {failed ? <Control sample={() => { const head = refresh()?.head; return head ? { p: head.p } : null; }} kind="left" /> : (
        <VrmBody actorId={take.actorId} body={take.body} live={live} recipe={recipe} reducedMotion={false} exact onFailed={() => setFailed(true)} speaking agent={false} mouth={() => current.current?.mouth ?? null} />
      )}
      <Control sample={control("left")} kind="left" />
      <Control sample={control("leftShadow")} kind="shadow" />
      <Control sample={control("right")} kind="right" />
      <Control sample={control("rightShadow")} kind="shadow" />
      <Control sample={mic} kind="mic" />
      <Control sample={ui} kind="ui" />
      {others.map((person) => <ReplayCompanion key={person.actorId} person={person} sample={() => refresh()?.others?.find((other) => other.actorId === person.actorId) ?? null} />)}
    </group>
  );
}

function ReplayCompanion({ person, sample }: { person: RecordedPerson; sample: () => RecordedPerson | null }) {
  const group = useRef<THREE.Group>(null);
  const recipe = useMemo(() => avatarRecipe(person.actorId), [person.actorId]);
  const [failed, setFailed] = useState(false);
  useFrame(() => { if (group.current) group.current.visible = sample() !== null; });
  const live = useCallback((): WirePerson | null => {
    const current = sample();
    if (!current) return null;
    const head = current.head;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(head.q.x, head.q.y, head.q.z, head.q.w));
    return { actorId: current.actorId, kind: current.kind, at: { x: head.p.x, y: 0, z: head.p.z }, moving: false, facing: Math.atan2(-forward.x, -forward.z), because: "recorded tutorial", connected: true, head, hands: current.hands, attending: null, avatar: current.avatar, body: current.body };
  }, [sample]);
  return <group ref={group}>{failed ? <Control sample={() => { const head = sample()?.head; return head ? { p: head.p } : null; }} kind="left" /> : <VrmBody actorId={person.actorId} body={person.body} live={live} recipe={recipe} reducedMotion={false} exact onFailed={() => setFailed(true)} speaking={false} agent={person.kind === "agent"} mouth={() => sample()?.mouth ?? null} />}</group>;
}
