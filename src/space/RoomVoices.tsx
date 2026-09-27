import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { registerRoomAudioContext, resumeRoomAudio } from "./room-audio";

function Voice({
  stream,
  listener,
  muted,
}: {
  stream: MediaStream;
  listener: THREE.AudioListener;
  muted: boolean;
}) {
  // THREE.Audio is intentionally non-positional: v1 is an ordinary room call,
  // not proximity chat. Spatial/proximity audio can be a later opt-in mode.
  const audio = useMemo(() => new THREE.Audio(listener), [listener]);

  useEffect(() => {
    audio.setMediaStreamSource(stream);
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

  return <primitive object={audio} />;
}

/** Room-wide, equal-level human voice; agents do not participate in this call. */
export function RoomVoices({ streams, muted }: { streams: Map<string, MediaStream>; muted: Set<string> }) {
  const camera = useThree((state) => state.camera);
  const listener = useMemo(() => new THREE.AudioListener(), []);

  /**
   * Browsers begin Web Audio contexts suspended until a user gesture. DOM
   * interactions resume it here; the room-call toggle also resumes it directly
   * because XR scene taps do not always dispatch browser DOM events.
   */
  useEffect(() => {
    const resume = () => {
      resumeRoomAudio();
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, resume, { passive: true });
    resume();
    return () => {
      for (const name of events) window.removeEventListener(name, resume);
    };
  }, [listener]);

  useEffect(() => {
    const unregister = registerRoomAudioContext(listener.context);
    camera.add(listener);
    return () => {
      unregister();
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
          stream={stream}
          listener={listener}
          muted={muted.has(actorId.trim().toLowerCase())}
        />
      ))}
    </>
  );
}
