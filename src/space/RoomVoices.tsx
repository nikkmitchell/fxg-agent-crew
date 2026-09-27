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

  /**
   * THE AUDIO CONTEXT IS NEVER CLOSED, and it does not follow the camera.
   *
   * Nikk (5404): calls worked in the browser and went silent for both people
   * the moment they entered VR. This effect used to depend on the camera and
   * close the context in its cleanup. Entering VR can hand the scene a
   * different camera, so the cleanup ran and closed the context, and a closed
   * AudioContext can never play again. It was also not ours to close: three
   * gives every AudioListener the same page-wide context
   * (THREE.AudioContext.getContext()), so closing it silenced every call for
   * the rest of the visit, including after changing rooms.
   */
  useEffect(() => registerRoomAudioContext(listener.context), [listener]);

  /** Only the listener's place moves with the camera. */
  useEffect(() => {
    camera.add(listener);
    resumeRoomAudio();
    return () => {
      camera.remove(listener);
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
