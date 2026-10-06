import { useEffect, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { PANEL } from "../../shared/space-layout";
import type { Placement } from "../../shared/space-wire";
import { Movable } from "./Movable";
import { ScreenFace, ScreenLabel } from "./ScreenWall";
import { useScreenShare } from "./screen-share";

/**
 * MY OWN SCREEN, OPENED FOR ME (Nikk, 7227: "there isn't a way to open it, if I
 * open it it should pop up as a tab like agents do, and it should be moveable
 * like the settings menu"). It opens in front of you, at a room panel's size,
 * and moves by its top bar the way the settings panel does. Where it is stays
 * in this page: it is yours, not the room's arrangement.
 */
const WIDTH = PANEL.width;
const HEIGHT = (PANEL.width * 9) / 16;
/** How far ahead of the eye it opens: in a headset, a panel's reading distance; in a window the camera stands back from you. */
const AHEAD_IN_HEADSET = 3.2;
const AHEAD_IN_WINDOW = 6;

export function MyScreen({ base, you, onTrouble }: { base: string; you: string; onTrouble: (why: string | null) => void }) {
  const camera = useThree((state) => state.camera);
  const presenting = useThree((state) => state.gl.xr.isPresenting);
  const [place, setPlace] = useState<Placement>(() => {
    const at = camera.getWorldPosition(new THREE.Vector3());
    const ahead = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (ahead.lengthSq() < 1e-6) ahead.set(0, 0, -1);
    ahead.normalize();
    const reach = presenting ? AHEAD_IN_HEADSET : AHEAD_IN_WINDOW;
    // A panel's face is +Z: turned to face back toward you.
    return {
      id: `myscreen-${you.toLowerCase()}`,
      position: { x: at.x + ahead.x * reach, y: 1.65, z: at.z + ahead.z * reach },
      rotationY: Math.atan2(-ahead.x, -ahead.z),
    };
  });
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const seq = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let held: THREE.Texture | null = null;
    const load = async () => {
      try {
        const response = await fetch(`${base}/bff/space/screens/${encodeURIComponent(you)}/frame`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) {
          if (!cancelled && held) { held.dispose(); held = null; setTexture(null); seq.current = null; }
          return;
        }
        const next = response.headers.get("x-screen-seq");
        if (next !== null && next === seq.current) return;
        // Through an <img>, as ScreenWall does: an ImageBitmap's flip is not specified, and a Quest drew them upside down.
        const url = URL.createObjectURL(await response.blob());
        let image: HTMLImageElement;
        try {
          image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("the frame could not be decoded"));
            element.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        if (cancelled) return;
        const fresh = new THREE.Texture(image);
        fresh.colorSpace = THREE.SRGBColorSpace;
        fresh.flipY = true;
        fresh.needsUpdate = true;
        held?.dispose();
        held = fresh;
        seq.current = next;
        setTexture(fresh);
      } catch {
        // The next second tries again.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      held?.dispose();
    };
  }, [base, you]);

  return (
    <Movable place={place} mode="locked" onPlaced={(next) => setPlace(next)} onTrouble={onTrouble}>
      {texture ? (
        <ScreenFace texture={texture} width={WIDTH} height={HEIGHT} />
      ) : (
        <ScreenLabel text="Not sharing yet: turn on Share my screen" width={WIDTH} height={0.3} />
      )}
    </Movable>
  );
}

/** My screen, while I have asked to see it (either settings menu: screen-share.ts). */
export function MyScreenHost({ base, you }: { base: string; you: string | null }) {
  const { shown } = useScreenShare();
  // Movable says on the panel itself why it would not move; nothing more to show here.
  return shown && you ? <MyScreen base={base} you={you} onTrouble={() => undefined} /> : null;
}
