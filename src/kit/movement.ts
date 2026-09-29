import * as THREE from "three";
import { DEFAULT_COMFORT, type Comfort } from "../space/comfort";
import { stickStep } from "../space/stick-walk";
import {
  IDLE,
  believableStep,
  stepJoystick,
  turnAbout,
  turnRate,
  walkVelocity,
  type JoystickState,
  type Quat,
  type Vec,
} from "../space/palm-joystick";

/**
 * MOVING, THE SAHA.ING WAY, IN A SPACE (Nikk, 2026-09-29: "can we keep the
 * movement controls the same from saha.ing ... so new pages don't need to
 * redo movement controls"). Built from saha.ing's own modules, not a copy:
 *
 *  - left thumbstick walks where you look (stick-walk.ts: the dead zone that
 *    stops a controller on a desk walking you away, speed rising from its edge);
 *  - right thumbstick turns: 30-degree snaps by default (comfort.ts), about
 *    your head so you stay on the spot;
 *  - tracked hands: the palm joystick (palm-joystick.ts), left walks, right turns;
 *  - no frame may move you more than believableStep allows (a mislocated hand
 *    is not a reason to fly);
 *  - on a computer: WASD or the arrows walk, Q/E turn, drag to look.
 *
 * Everything moves the PLAYER rig that carries the camera; in a headset your
 * head moves inside it.
 */

export type Movement = { update: (delta: number) => void; dispose: () => void };

export function createMovement(options: {
  renderer: THREE.WebGLRenderer;
  player: THREE.Object3D;
  camera: THREE.Camera;
  comfort?: Comfort;
}): Movement {
  const { renderer, player, camera } = options;
  const comfort = options.comfort ?? DEFAULT_COMFORT;
  const joystick: { left: JoystickState; right: JoystickState } = { left: IDLE, right: IDLE };
  let snapArmed = true;
  const keys = new Set<string>();
  const head = new THREE.Vector3();
  const look = new THREE.Vector3();

  // The palm joystick's balls, carried by the rig (their positions are in its frame).
  const ball = (opacity: number) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity }));
    mesh.visible = false;
    player.add(mesh);
    return mesh;
  };
  const balls = { left: ball(0.95), leftShadow: ball(0.35), right: ball(0.95), rightShadow: ball(0.35) };

  const headYaw = () => {
    camera.getWorldDirection(look);
    return Math.atan2(-look.x, -look.z);
  };
  const turn = (angle: number) => {
    camera.getWorldPosition(head);
    const turned = turnAbout({ x: player.position.x, z: player.position.z, yaw: player.rotation.y }, { x: head.x, z: head.z }, angle);
    player.position.x = turned.x;
    player.position.z = turned.z;
    player.rotation.y = turned.yaw;
  };

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (down) keys.add(key);
    else keys.delete(key);
  };
  const keyDown = onKey(true);
  const keyUp = onKey(false);
  addEventListener("keydown", keyDown);
  addEventListener("keyup", keyUp);
  addEventListener("blur", () => keys.clear());

  // Drag to look, on a computer.
  let dragging: { x: number; y: number } | null = null;
  const canvas = renderer.domElement;
  const down = (event: PointerEvent) => {
    if (renderer.xr.isPresenting) return;
    dragging = { x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent) => {
    if (!dragging || renderer.xr.isPresenting) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    dragging = { x: event.clientX, y: event.clientY };
    player.rotation.y -= dx * 0.005;
    camera.rotation.x = Math.max(-1.3, Math.min(1.3, camera.rotation.x - dy * 0.005));
  };
  const up = () => {
    dragging = null;
  };
  canvas.addEventListener("pointerdown", down);
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);

  const palmOf = (source: XRInputSource, frame: XRFrame, space: XRReferenceSpace): { p: Vec; q: Quat } | null => {
    const joint = source.hand?.get("middle-finger-metacarpal") ?? source.hand?.get("wrist");
    const pose = joint && frame.getJointPose ? frame.getJointPose(joint, space) : undefined;
    if (!pose) return null;
    const { position: p, orientation: q } = pose.transform;
    return { p: { x: p.x, y: p.y, z: p.z }, q: { x: q.x, y: q.y, z: q.z, w: q.w } };
  };

  const update = (rawDelta: number) => {
    const delta = Math.min(rawDelta, 0.1);
    const stood = { x: player.position.x, z: player.position.z };

    if (renderer.xr.isPresenting) {
      const session = renderer.xr.getSession();
      const frame = renderer.xr.getFrame();
      const space = renderer.xr.getReferenceSpace();
      let leftPalm: { p: Vec; q: Quat } | null = null;
      let rightPalm: { p: Vec; q: Quat } | null = null;
      for (const source of session?.inputSources ?? []) {
        if (source.hand && frame && space) {
          if (source.handedness === "left") leftPalm = palmOf(source, frame, space);
          if (source.handedness === "right") rightPalm = palmOf(source, frame, space);
          continue;
        }
        const pad = source.gamepad;
        if (!pad) continue;
        const x = pad.axes[2] ?? 0;
        const y = pad.axes[3] ?? 0;
        if (source.handedness === "left") {
          const step = stickStep({ x, y }, headYaw(), comfort.speed, delta);
          player.position.x += step.x;
          player.position.z += step.z;
        } else if (source.handedness === "right") {
          if (comfort.turn === "snap") {
            // One snap per flick, re-armed when the stick comes back.
            if (Math.abs(x) > 0.5 && snapArmed) {
              turn((x > 0 ? -1 : 1) * (comfort.snapDegrees * Math.PI) / 180);
              snapArmed = false;
            } else if (Math.abs(x) < 0.3) snapArmed = true;
          } else if (Math.abs(x) > 0.15) {
            turn(-x * 2 * delta);
          }
        }
      }

      // THE PALM JOYSTICK: hands only, every frame.
      const now = performance.now();
      const left = stepJoystick(joystick.left, leftPalm, now);
      const right = stepJoystick(joystick.right, rightPalm, now);
      joystick.left = left.state;
      joystick.right = right.state;
      const yaw = player.rotation.y;
      if (left.state.phase === "active" && left.ball) {
        const v = walkVelocity(left.state.anchor, left.ball);
        player.position.x += (v.x * Math.cos(yaw) + v.z * Math.sin(yaw)) * delta;
        player.position.z += (-v.x * Math.sin(yaw) + v.z * Math.cos(yaw)) * delta;
      }
      if (right.state.phase === "active" && right.ball) {
        const rate = turnRate(right.state.anchor, right.ball, headYaw() - yaw);
        if (rate !== 0) turn(rate * delta);
      }
      const show = (mesh: THREE.Mesh, where: Vec | null) => {
        mesh.visible = where !== null;
        if (where) mesh.position.set(where.x, where.y, where.z);
      };
      show(balls.left, left.ball);
      show(balls.leftShadow, left.state.phase === "active" ? left.state.anchor : null);
      show(balls.right, right.ball);
      show(balls.rightShadow, right.state.phase === "active" ? right.state.anchor : null);
    } else {
      // On a computer.
      const forward = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
      const sideways = (keys.has("d") ? 1 : 0) - (keys.has("a") ? 1 : 0);
      if (forward || sideways) {
        const step = stickStep({ x: sideways, y: -forward }, headYaw(), comfort.speed, delta);
        player.position.x += step.x;
        player.position.z += step.z;
      }
      const turning = (keys.has("q") || keys.has("arrowleft") ? 1 : 0) - (keys.has("e") || keys.has("arrowright") ? 1 : 0);
      if (turning) player.rotation.y += turning * 1.6 * delta;
    }

    // No frame moves anybody further than a person could walk in it.
    if (!believableStep(stood, { x: player.position.x, z: player.position.z })) {
      player.position.x = stood.x;
      player.position.z = stood.z;
    }
  };

  return {
    update,
    dispose: () => {
      removeEventListener("keydown", keyDown);
      removeEventListener("keyup", keyUp);
      canvas.removeEventListener("pointerdown", down);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      for (const mesh of Object.values(balls)) player.remove(mesh);
    },
  };
}
