import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EYE_HEIGHT } from "./Avatar3D";
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
}: {
  actorId: string;
  stream: MediaStream;
  listener: THREE.AudioListener;
  peopleRef: SpaceConnection["peopleRef"];
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

  useFrame(() => {
    const person = peopleRef.current.find((p) => p.actorId === actorId);
    if (!person) return;
    // The HEAD when we have one, because that is where a voice comes from, and
    // the feet plus a standing eye height when we do not. Never the origin: a
    // voice from (0,0,0) is a voice from under the floor in the middle of the
    // room, which sounds like a bug in the audio rather than a missing head.
    const at = person.head?.p ?? { x: person.at.x, y: EYE_HEIGHT, z: person.at.z };
    audio.position.set(at.x, at.y, at.z);
  });

  return <primitive object={audio} />;
}

export function SpatialVoices({
  streams,
  peopleRef,
}: {
  streams: Map<string, MediaStream>;
  peopleRef: SpaceConnection["peopleRef"];
}) {
  const camera = useThree((state) => state.camera);
  const listener = useMemo(() => new THREE.AudioListener(), []);

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
        />
      ))}
    </>
  );
}
