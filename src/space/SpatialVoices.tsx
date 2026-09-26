import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { headOf } from "./Avatar3D";
import type { SpaceConnection } from "./useSpaceSocket";

/**
 * Voices where their speakers are standing.
 *
 * The first version played everyone through a plain `<audio>` element: equally
 * loud, from nowhere. In a room you can walk around that is a real miss —
 * turning your head should change what you hear, and with four people talking
 * it is the only thing that makes a crowd followable.
 *
 * WHY THE MUTED `<audio>` ELEMENT IN useVoiceChat STILL EXISTS. A MediaStream
 * that is never attached to a media element does not flow in Chrome. The
 * element is what makes the audio arrive at all; this is what decides where it
 * appears to come from. Deleting the "redundant" element gives you silence with
 * no error anywhere, which is a miserable afternoon.
 *
 * POSITIONS COME FROM THE SAME REF THE FIGURES USE, read each frame. A voice
 * that lagged its speaker by a React render would be audibly detached from the
 * person, which is worse than not positioning it at all.
 */

/** How far a voice carries before it is inaudible. The room is 20m across. */
const REACH = 14;

function Voice({
  actorId,
  stream,
  listener,
  peopleRef,
  muted,
}: {
  actorId: string;
  stream: MediaStream;
  listener: THREE.AudioListener;
  peopleRef: SpaceConnection["peopleRef"];
  /** Muted by this listener: silent here, and nowhere else. */
  muted: boolean;
}) {
  const audio = useMemo(() => new THREE.PositionalAudio(listener), [listener]);

  useEffect(() => {
    // `setMediaStreamSource` builds the Web Audio graph from the live stream.
    audio.setMediaStreamSource(stream);
    audio.setRefDistance(1.6);
    audio.setMaxDistance(REACH);
    audio.setRolloffFactor(1.4);
    audio.setDistanceModel("linear");
    return () => {
      try {
        audio.disconnect();
      } catch {
        // Already torn down by three when the object left the scene.
      }
    };
  }, [audio, stream]);

  useEffect(() => {
    audio.setVolume(muted ? 0 : 1);
  }, [audio, muted]);

  useFrame(() => {
    const person = peopleRef.current.find((p) => p.actorId === actorId);
    if (!person) return;
    // Where a voice comes from is where the head is — the same answer the
    // figure is drawn with, from the same function, so a voice cannot end up
    // somewhere its speaker's head is not.
    const at = headOf(person);
    audio.position.set(at.x, at.y, at.z);
  });

  return <primitive object={audio} />;
}

export function SpatialVoices({
  streams,
  muted,
  peopleRef,
}: {
  streams: Map<string, MediaStream>;
  muted: Set<string>;
  peopleRef: SpaceConnection["peopleRef"];
}) {
  const camera = useThree((state) => state.camera);
  const listener = useMemo(() => new THREE.AudioListener(), []);

  /**
   * UNLOCK SOUND ON THE FIRST TOUCH. Browsers start an audio context suspended
   * until the person does something, so a listener who never pressed anything
   * after entering heard nothing — a voice arriving before any click was
   * silence with no error. Any press, key or headset select resumes it.
   */
  useEffect(() => {
    const resume = () => {
      if (listener.context.state !== "running") void listener.context.resume().catch(() => undefined);
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, resume, { passive: true });
    resume();
    return () => {
      for (const name of events) window.removeEventListener(name, resume);
    };
  }, [listener]);

  useEffect(() => {
    // The listener is the ear, so it rides the camera — which in a session is
    // the headset's own pose, so turning your head turns your hearing.
    camera.add(listener);
    return () => {
      camera.remove(listener);
      void listener.context.close().catch(() => {
        // Already closed, or never opened because nobody ever spoke.
      });
    };
  }, [camera, listener]);

  return (
    <>
      {[...streams.entries()].map(([actorId, stream]) => (
        <Voice
          key={actorId}
          actorId={actorId}
          stream={stream}
          listener={listener}
          peopleRef={peopleRef}
          muted={muted.has(actorId.trim().toLowerCase())}
        />
      ))}
    </>
  );
}
