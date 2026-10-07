import { useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { WristButton } from "./Backdrop";
import { UP_CONTROL_SIZE, lookingUp, upGearAt } from "./control-pose";

/**
 * THE GEAR UP WHERE YOU LOOK, IN THE WINDOW TOO (Nikk 7448: "allow for settings
 * to be selected by looking up"). The headset's own gesture: drag the view up
 * past about 33° and the ⚙ floats along your gaze; press it and the settings
 * open. The same thresholds and place as the headset's (control-pose.ts), so a
 * person learns it once.
 */
export function WindowUpGear({ onOpen }: { onOpen: () => void }) {
  const group = useRef<THREE.Group>(null);
  const shown = useRef(false);
  const [visible, setVisible] = useState(false);
  useFrame((state) => {
    const node = group.current;
    if (!node) return;
    const eyes = state.camera.getWorldPosition(new THREE.Vector3());
    const gaze = state.camera.getWorldDirection(new THREE.Vector3());
    const now = lookingUp(shown.current, Math.asin(Math.max(-1, Math.min(1, gaze.y))));
    if (now !== shown.current) {
      shown.current = now;
      setVisible(now);
    }
    node.visible = now;
    if (!now) return;
    const at = upGearAt(eyes, gaze);
    node.position.set(at.x, at.y, at.z);
    node.lookAt(eyes);
  });
  return (
    <group ref={group} visible={false}>
      {visible ? <WristButton label="⚙" glyph tone="menu" x={0} y={0} width={UP_CONTROL_SIZE} height={UP_CONTROL_SIZE} opacity={0.75} onTap={onOpen} /> : null}
    </group>
  );
}
