import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { clockOffset } from "../../shared/meditation";
import { dawnWarmthAt } from "../../shared/dawn";
import { space } from "../space-client";

const BASE_SKY = new THREE.Color("#ffffff");
const DAWN_SKY = new THREE.Color("#ffdfb6");
const BASE_GROUND = new THREE.Color("#2a3040");
const DAWN_GROUND = new THREE.Color("#6b4b39");
const BASE_INTENSITY = 2.2;

/**
 * A shared, wordless color wash: ten-minute sunrise at 06:00 UTC, a quiet
 * daytime hold, and a ten-minute settle at 18:00. This is the room's existing
 * hemisphere light, not another lamp or draw call. No audio, motion samples,
 * or new saved state. A reduced-motion session freezes at today's endpoint.
 */
export function SharedDawn({ reducedMotion, active, now }: { reducedMotion: boolean; active: boolean; now?: () => number }) {
  const light = useRef<THREE.HemisphereLight>(null);
  const offset = useRef(0);
  const frozenWarmth = useRef<number | null>(null);

  useEffect(() => {
    if (now || !active) return;
    let live = true;
    const sent = Date.now();
    void space.meditation().then((answer) => {
      if (live) {
        offset.current = clockOffset(answer.now, sent, Date.now());
        frozenWarmth.current = null;
      }
    }).catch(() => {
      // The UTC client clock is a safe fallback if the room clock is offline.
    });
    return () => { live = false; };
  }, [active, now]);

  useEffect(() => {
    frozenWarmth.current = null;
  }, [active, reducedMotion]);

  useFrame(() => {
    const instant = now ? now() : Date.now() + offset.current;
    let warmth: number;
    if (!active) {
      frozenWarmth.current = null;
      warmth = 0;
    } else if (reducedMotion) {
      frozenWarmth.current ??= dawnWarmthAt(instant, true);
      warmth = frozenWarmth.current;
    } else {
      frozenWarmth.current = null;
      warmth = dawnWarmthAt(instant);
    }

    if (light.current) {
      light.current.color.copy(BASE_SKY).lerp(DAWN_SKY, warmth);
      light.current.groundColor.copy(BASE_GROUND).lerp(DAWN_GROUND, warmth);
      light.current.intensity = BASE_INTENSITY + 0.22 * warmth;
    }
  });

  return (
    <hemisphereLight ref={light} args={[BASE_SKY, BASE_GROUND, BASE_INTENSITY]} />
  );
}
