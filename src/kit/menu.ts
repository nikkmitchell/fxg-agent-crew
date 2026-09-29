import * as THREE from "three";

/**
 * THE WRIST MENU, in a headset: a small panel over your left wrist, shown
 * when you turn the wrist toward your face (like a watch), with the buttons
 * everyone needs in every space. Point the right controller (or pinch with a
 * tracked hand) and press. More buttons come with voice (mute).
 */

export type MenuButton = { label: string; onPress: () => void };

export type WristMenu = { update: () => void; setButtons: (buttons: MenuButton[]) => void; dispose: () => void };

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
        new THREE.PlaneGeometry(0.12, 0.03),
        new THREE.MeshBasicMaterial({ map: buttonTexture(button.label, false), transparent: true, depthTest: false }),
      );
      mesh.renderOrder = 10;
      mesh.position.set(0, 0.075 - index * 0.036, 0);
      panel.add(mesh);
      return { mesh, button, label: button.label };
    });
  };

  // Which controller/hand is which: learned from their `connected` events.
  const controllers = [0, 1].map((index) => {
    const ray = renderer.xr.getController(index);
    const grip = renderer.xr.getControllerGrip(index);
    player.add(ray, grip);
    const state = { ray, grip, handedness: "none" as XRHandedness };
    ray.addEventListener("connected", (event: { data?: XRInputSource }) => {
      state.handedness = event.data?.handedness ?? "none";
    });
    ray.addEventListener("disconnected", () => {
      state.handedness = "none";
    });
    ray.addEventListener("select", () => {
      if (!panel.visible || state.handedness === "left") return;
      const hit = aim(ray);
      const found = buttons.find((each) => each.mesh === hit);
      found?.button.onPress();
    });
    return state;
  });

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const aim = (ray: THREE.Object3D): THREE.Object3D | null => {
    ray.getWorldPosition(origin);
    direction.set(0, 0, -1).applyQuaternion(ray.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(origin, direction);
    return raycaster.intersectObjects(buttons.map((each) => each.mesh), false)[0]?.object ?? null;
  };

  const headAt = new THREE.Vector3();
  const panelAt = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const update = () => {
    const left = controllers.find((each) => each.handedness === "left");
    if (!renderer.xr.isPresenting || !left || buttons.length === 0) {
      panel.visible = false;
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
    const target = panel.visible && right ? aim(right.ray) : null;
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
      player.remove(panel);
    },
  };
}
