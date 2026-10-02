import * as THREE from "three";

/**
 * THE WRIST MENU, in a headset: a small panel over your left wrist, shown
 * when you turn the wrist toward your face (like a watch), with the buttons
 * everyone needs in every space. TWO WAYS TO PRESS (Baiwei, 6389/6391: "needs
 * a pointer", "the sphere needs to touch a button"): point the right
 * controller, which now DRAWS a line and a dot where it lands, and pull the
 * trigger; or touch a button with the controller's own white sphere. More
 * buttons come with voice (mute).
 */

export type MenuButton = { label: string; onPress: () => void };

export type WristMenu = { update: () => void; setButtons: (buttons: MenuButton[]) => void; dispose: () => void };

/** Button size and spacing on the wrist panel, in metres: big enough to hit while the arm is moving. */
export const MENU_BUTTON = { width: 0.16, height: 0.04, gap: 0.048, top: 0.1 } as const;
/** A touch: the controller's sphere within this of the button's face (its radius is 2.5 cm), then out again before the next. */
export const MENU_TOUCH = { near: 0.03, rearm: 0.06 } as const;

/** Which button, if any, a point in the panel's own frame is touching; pure so it can be tested. */
export function touchedButton(local: { x: number; y: number; z: number }, count: number): number {
  const half = { x: MENU_BUTTON.width / 2, y: MENU_BUTTON.height / 2 };
  if (Math.abs(local.z) > MENU_TOUCH.near) return -1;
  for (let index = 0; index < count; index += 1) {
    const centre = MENU_BUTTON.top - index * MENU_BUTTON.gap;
    if (Math.abs(local.x) <= half.x && Math.abs(local.y - centre) <= half.y) return index;
  }
  return -1;
}

function buttonTexture(text: string, hot: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.fillStyle = hot ? "#3b82f6" : "rgba(20,23,28,.9)";
  context.beginPath();
  if (context.roundRect) context.roundRect(2, 2, 252, 60, 18);
  else context.rect(2, 2, 252, 60);
  context.fill();
  context.fillStyle = "#fff";
  context.font = "600 26px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 128, 33, 240);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWristMenu(options: { renderer: THREE.WebGLRenderer; player: THREE.Object3D; camera: THREE.Camera }): WristMenu {
  const { renderer, player, camera } = options;
  const panel = new THREE.Group();
  panel.visible = false;
  player.add(panel);
  let buttons: { mesh: THREE.Mesh; button: MenuButton; label: string }[] = [];
  let hot: THREE.Mesh | null = null;

  const setButtons = (next: MenuButton[]) => {
    for (const each of buttons) {
      panel.remove(each.mesh);
      (each.mesh.material as THREE.MeshBasicMaterial).map?.dispose();
      (each.mesh.material as THREE.MeshBasicMaterial).dispose();
      each.mesh.geometry.dispose();
    }
    buttons = next.map((button, index) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(MENU_BUTTON.width, MENU_BUTTON.height),
        new THREE.MeshBasicMaterial({ map: buttonTexture(button.label, false), transparent: true, depthTest: false }),
      );
      mesh.renderOrder = 10;
      mesh.position.set(0, MENU_BUTTON.top - index * MENU_BUTTON.gap, 0);
      panel.add(mesh);
      return { mesh, button, label: button.label };
    });
  };

  // Which controller/hand is which: learned from their `connected` events.
  const controllers = [0, 1].map((index) => {
    const ray = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    player.add(ray, grip);
    const state = { ray, grip, handedness: "none" as XRHandedness, source: null as XRInputSource | null, armed: true };
    ray.addEventListener("connected", (event: { data?: XRInputSource }) => {
      state.handedness = event.data?.handedness ?? "none";
      state.source = event.data ?? null;
    });
    ray.addEventListener("disconnected", () => {
      state.handedness = "none";
      state.source = null;
    });
    ray.addEventListener("select", () => {
      if (!panel.visible || state.handedness === "left") return;
      const hit = aim(ray);
      const found = buttons.find((each) => each.mesh === hit);
      if (found) {
        buzz(state.source);
        found.button.onPress();
      }
    });
    return state;
  });

  // The pointer: a line from the right controller to where it lands (or a short
  // stub when it lands on nothing), and a dot at the button, so you can see
  // what you are about to press. Lives on the controller's own ray.
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.9, depthTest: false }),
  );
  line.renderOrder = 11;
  line.visible = false;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
  dot.renderOrder = 12;
  dot.visible = false;
  let pointerOn: THREE.Object3D | null = null;
  const showPointer = (ray: THREE.Object3D | null, distance: number, landed: boolean) => {
    if (pointerOn !== ray) {
      pointerOn?.remove(line, dot);
      ray?.add(line, dot);
      pointerOn = ray;
    }
    line.visible = ray !== null;
    line.scale.z = distance;
    dot.visible = ray !== null && landed;
    dot.position.set(0, 0, -distance);
  };

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const aimHit = (ray: THREE.Object3D) => {
    ray.getWorldPosition(origin);
    direction.set(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(origin, direction);
    return raycaster.intersectObjects(buttons.map((each) => each.mesh), false)[0] ?? null;
  };
  const aim = (ray: THREE.Object3D): THREE.Object3D | null => aimHit(ray)?.object ?? null;
  /** A short buzz in the hand that pressed, where the controller has one. */
  const buzz = (source: XRInputSource | null) => {
    try {
      void (source?.gamepad as (Gamepad & { vibrationActuator?: { playEffect: (kind: string, options: object) => Promise<unknown> } }) | undefined)
        ?.vibrationActuator?.playEffect("dual-rumble", { duration: 40, strongMagnitude: 0.3, weakMagnitude: 0.3 });
    } catch {
      /* a controller without haptics: nothing to do */
    }
  };
  const tip = new THREE.Vector3();

  const headAt = new THREE.Vector3();
  const panelAt = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const update = () => {
    const left = controllers.find((each) => each.handedness === "left");
    if (!renderer.xr.isPresenting || !left || buttons.length === 0) {
      panel.visible = false;
      showPointer(null, 0, false);
      return;
    }
    // Over the back of the left wrist, facing out of it.
    panel.position.copy(left.grip.position);
    panel.quaternion.copy(left.grip.quaternion);
    panel.translateY(0.06);
    panel.rotateX(-Math.PI / 2);
    // Shown only when the wrist is turned toward your face.
    camera.getWorldPosition(headAt);
    panel.getWorldPosition(panelAt);
    facing.set(0, 0, 1).applyQuaternion(panel.getWorldQuaternion(new THREE.Quaternion()));
    panel.visible = facing.dot(headAt.sub(panelAt).normalize()) > 0.55;
    // Light the button the right hand points at.
    const right = controllers.find((each) => each.handedness === "right");
    const hit = panel.visible && right ? aimHit(right.ray) : null;
    const target = hit?.object ?? null;
    if (panel.visible && right) showPointer(right.ray, hit ? hit.distance : 0.5, hit !== null);
    else showPointer(null, 0, false);
    // Touch: the right controller's own sphere against a button's face.
    if (panel.visible && right) {
      right.grip.getWorldPosition(tip);
      panel.updateWorldMatrix(true, false);
      const local = panel.worldToLocal(tip);
      const touched = touchedButton(local, buttons.length);
      if (touched >= 0 && right.armed) {
        right.armed = false;
        buzz(right.source);
        buttons[touched]?.button.onPress();
      } else if (touched < 0 && Math.abs(local.z) > MENU_TOUCH.rearm) {
        right.armed = true;
      }
    }
    if (target !== hot) {
      for (const each of buttons) {
        const lit = each.mesh === target;
        const material = each.mesh.material as THREE.MeshBasicMaterial;
        material.map?.dispose();
        material.map = buttonTexture(each.label, lit);
        material.needsUpdate = true;
      }
      hot = target as THREE.Mesh | null;
    }
  };

  return {
    update,
    setButtons,
    dispose: () => {
      setButtons([]);
      showPointer(null, 0, false);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      dot.geometry.dispose();
      (dot.material as THREE.Material).dispose();
      player.remove(panel);
    },
  };
}
