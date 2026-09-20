import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { loadVrm, faceFrontZOf } from "./vrm-model";
import { agentAnimationSelection, createAgentAnimationPlayer, type AgentAnimationPlayer } from "./agent-animation";

/**
 * One body, standing there breathing, on a profile.
 *
 * Nikk: "when clicking on someone I also want to be able to see their avatar,
 * maybe a simple box that has it rendering in 3d with an idle animatiion".
 *
 * WHY NOT REUSE Avatar3D OR VrmBody. Both are the room's figures and take the
 * room's live state — a WirePerson, a socket, a pose arriving every tick. A
 * profile has none of that and faking it would mean inventing a person to look
 * at. This loads the same model with the same loader and plays the same idle
 * clips, and knows nothing about the room.
 *
 * IT IS THE SAME MODEL THE ROOM DRAWS, deliberately: `loadVrm` and the shared
 * animation player, so the figure here and the figure across the room cannot
 * drift apart into two different-looking versions of the same person.
 *
 * LAZY, because three and a VRM are megabytes and most visits to /profiles are
 * to read rather than to look. Nothing here is downloaded until somebody opens
 * a profile.
 */

/**
 * How tall every figure is drawn here, in world units, whatever it is in metres.
 * The camera below is placed to frame exactly this and never moves again.
 */
const STAGE_HEIGHT = 1.6;

function Figure({ actorId, body, onFailed }: {
  actorId: string;
  body: string | null;
  onFailed: (why: string) => void;
}) {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const player = useRef<AgentAnimationPlayer | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: VRM | null = null;
    void (async () => {
      try {
        const model = await loadVrm(actorId, body);
        if (!live) return;
        loaded = model;
        player.current = await createAgentAnimationPlayer(model);
        if (!live) return;
        setVrm(model);

        // TURN IT ROUND. A model states which way its own front is, and half of
        // them face -Z. Without this you get the back of somebody's head, which
        // is what the first version rendered — and it reads as a broken model
        // rather than a camera pointed at the wrong side of a working one.
        model.scene.rotation.y = faceFrontZOf(model) > 0 ? 0 : Math.PI;

        /**
         * FIT THE FIGURE TO A FIXED CAMERA, rather than the camera to the
         * figure.
         *
         * I tried it the other way twice — in the load, then on the first
         * frame — and got a blank box once and a pair of shins the next time.
         * Moving a camera means racing R3F's own camera setup and whatever the
         * canvas does on resize. The model's transform is mine alone, so this
         * is the version with no ordering to get wrong.
         *
         * Bodies here run about 1.3m to 1.8m; scaling to a constant height is
         * also what stops a short one being a speck beside a tall one.
         */
        const box = new THREE.Box3().setFromObject(model.scene);
        const height = box.max.y - box.min.y;
        if (Number.isFinite(height) && height > 0.01) {
          const fit = STAGE_HEIGHT / height;
          model.scene.scale.setScalar(fit);
          const middle = ((box.max.y + box.min.y) / 2) * fit;
          model.scene.position.set(
            -((box.max.x + box.min.x) / 2) * fit,
            -middle,
            -((box.max.z + box.min.z) / 2) * fit,
          );
        }
      } catch (error) {
        if (live) onFailed(error instanceof Error ? error.message : "that body could not be loaded");
      }
    })();
    return () => {
      live = false;
      player.current?.dispose();
      player.current = null;
      // A VRM holds textures and geometry; dropping the reference alone leaks
      // them on every profile you open.
      if (loaded) loaded.scene.removeFromParent();
    };
  }, [actorId, body, onFailed]);

  useFrame((_, delta) => {
    if (!player.current) return;

    const selection = agentAnimationSelection({
      actorId,
      moving: false,
      speaking: false,
      attending: false,
      mood: "focused",
      posture: "thinking",
      gesture: null,
      gestureStartedAt: null,
      reducedMotion: false,
      nowMs: performance.now(),
    });
    player.current.update(delta, selection, false);
    vrm?.update(delta);
  });

  return vrm ? <primitive object={vrm.scene} /> : null;
}

export function BodyStage({ actorId, body }: { actorId: string; body: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const reduced = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  if (failed) {
    // Say what happened. A blank box reads as "this person has no body".
    return <p className="profile-absent">{failed}</p>;
  }

  return (
    <div className="body-stage">
      <Canvas
        // THE CAMERA IS SET HERE AND NEVER MOVED, the way the room's Scene does
        // it. I had been positioning it inside the async load instead, and a
        // camera mutated after the fact is a good way to end up looking at
        // nothing — which is exactly what I got: a canvas that rendered, with
        // an empty frame, while the model and the animations had all loaded 200.
        //
        // The distance suits a figure of roughly human height at this field of
        // view; the models here run about 1.3m to 1.8m and all sit inside it.
        camera={{ fov: 30, near: 0.05, far: 20, position: [0, 0, 3.4] }}
        gl={{ antialias: true }}
        frameloop={reduced ? "demand" : "always"}
      >
        {/* A real background, attached to the scene — a CSS background on the
            canvas element renders even when WebGL draws nothing at all, which
            is how a blank scene can look like a working one. */}
        <color attach="background" args={["#f2efe5"]} />
        <ambientLight intensity={2.1} />
        <directionalLight position={[1.4, 2.2, 1.8]} intensity={1.7} />
        <directionalLight position={[-1.6, 1.2, -1.2]} intensity={0.5} />
        <Figure actorId={actorId} body={body} onFailed={setFailed} />
      </Canvas>
    </div>
  );
}

export default BodyStage;
