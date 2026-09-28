import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { BATH_SECONDS, bathScore, notesBetween } from "../../shared/sound-bath";
import { BOWLS } from "../../shared/bowl";
import { onBath } from "./bath-events";
import { ringBowl, singBowl } from "./bowl-sound";
import { soundGong, GONG_AT } from "./GongStand";
import { ringTube, CHIME_NOTES } from "./WindChimes";
import { WristButton } from "./Backdrop";
import { space } from "../space-client";
import { ROOM } from "../../shared/space-layout";

/**
 * THE SOUND BATH (shared/sound-bath.ts): a small sign beside the gong. Tap
 * "begin a sound bath" and for six minutes the room's bowls, gong and chimes
 * play a slow composed wash for everyone in the room, from the same score at
 * the same moment. Tap again to end it early.
 */

const SIGN_AT = { x: GONG_AT.x - 0.9, z: GONG_AT.z + 0.1 } as const;

export function SoundBath() {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const offset = useRef(0);
  const played = useRef(0);
  const score = useMemo(() => bathScore(), []);
  const [, tick] = useState(0);

  useEffect(() => {
    space.soundBath().then((answer) => {
      offset.current = answer.now - Date.now();
      setStartedAt(answer.startedAt);
      if (answer.startedAt) played.current = (answer.now - answer.startedAt) / 1000;
    }).catch(() => {});
  }, []);
  useEffect(
    () =>
      onBath((bath) => {
        setStartedAt(bath.startedAt);
        played.current = bath.startedAt ? (Date.now() + offset.current - bath.startedAt) / 1000 : 0;
      }),
    [],
  );
  // The countdown on the sign.
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useFrame(() => {
    if (!startedAt) return;
    const elapsed = (Date.now() + offset.current - startedAt) / 1000;
    if (elapsed > BATH_SECONDS) {
      setStartedAt(null);
      return;
    }
    for (const note of notesBetween(score, played.current, elapsed)) {
      if (note.instrument === "gong") soundGong(note.strength, 3);
      else if (note.instrument === "chime") ringTube(CHIME_NOTES[note.which % CHIME_NOTES.length], note.strength);
      else if (note.instrument === "sing") for (let i = 0; i < 6; i += 1) setTimeout(() => singBowl(BOWLS[note.which].note, note.strength, 2), i * 300);
      else ringBowl(BOWLS[note.which].note, note.strength, 2);
    }
    played.current = elapsed;
  });

  const left = startedAt ? Math.max(0, BATH_SECONDS - (Date.now() + offset.current - startedAt) / 1000) : 0;
  const clock = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`;
  const facing = Math.atan2(ROOM.spawn.x - SIGN_AT.x, ROOM.spawn.z - SIGN_AT.z);

  return (
    <group position={[SIGN_AT.x, 1.2, SIGN_AT.z]} rotation={[0, facing, 0]}>
      <WristButton
        label={startedAt ? `sound bath · ${clock} left · tap to end` : "begin a sound bath · 6 minutes"}
        y={0}
        width={0.56}
        height={0.08}
        lines={1}
        textSize={0.38}
        tone={startedAt ? "muted" : "live"}
        onTap={() => {
          space.changeSoundBath(startedAt ? "stop" : "start").then((answer) => {
            offset.current = answer.now - Date.now();
            played.current = 0;
            setStartedAt(answer.startedAt);
          }).catch(() => {});
        }}
      />
    </group>
  );
}
