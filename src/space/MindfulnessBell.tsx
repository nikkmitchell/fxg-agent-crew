import { useEffect, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { bellPause, breathAt, type Meditation } from "../../shared/meditation";
import { bell } from "./breath-sound";
import { ORB_AT } from "./MeditationOrb";

/**
 * THE MINDFULNESS BELL (shared/meditation.ts, bellPause): on every quarter
 * hour the bell rings and a line above the orb asks the room to stop for
 * three breaths. Rung by each device from its own clock, so it lands together
 * without the server. Silent for anyone who has the orb's SOUND off, and never
 * during a session, which has its own bells.
 */
export function MindfulnessBell({ meditation }: { meditation: Meditation }) {
  const [pause, setPause] = useState<number | null>(null);
  const rung = useRef<number | null>(null);
  const live = useRef(meditation);
  live.current = meditation;

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const due = bellPause(now);
      const inSession = breathAt(live.current, now).state === "breathing";
      if (due && !inSession) {
        // Ring once per bell, and only if we were here when it rang, not for
        // a bell that went off before this page opened.
        if (rung.current !== due.rangAt && due.left > 15_000) {
          rung.current = due.rangAt;
          let soundOn = true;
          try { soundOn = localStorage.getItem("orb-sound") !== "off"; } catch { /* default on */ }
          if (soundOn) bell();
        }
        setPause(rung.current === due.rangAt ? Math.ceil(due.left / 1000) : null);
      } else {
        setPause(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (pause === null) return null;
  return <Text position={[ORB_AT[0], ORB_AT[1] + 0.82, ORB_AT[2]]} fontSize={0.05} color="#f2d59a" outlineWidth={0.003} outlineColor="#0b1418" raycast={() => undefined}>
    {`THE BELL · STOP FOR THREE BREATHS · ${pause}`}
  </Text>;
}
