import * as THREE from "three";
import { CSS3DObject, CSS3DRenderer } from "three/addons/renderers/CSS3DRenderer.js";

/**
 * A SCREEN IN A ROOM: any space, or any web page, on a panel you can use.
 * (Sill's plan for spaces, B: "openScreen(url, at) puts any space (2D or VR)
 * on a panel in a room".)
 *
 *   const screen = room.openScreen("/s/xr.instruments/", [0, 1.4, -2]);
 *   screen.close();
 *
 * ON A COMPUTER it is the real page, live and usable: an iframe placed in the
 * scene with three's CSS3DRenderer, so you click, type and scroll in it where
 * it stands. It is drawn over the 3D view, so a figure walking in front of it
 * does not hide it; that is the one honest limit of an iframe in a 3D scene.
 *
 * IN A HEADSET no browser can draw a web page inside a WebXR session, so the
 * screen is a panel with the page's name. Point at it and pull the trigger (or
 * pinch) and you go there; a saha.ing space keeps you in VR through the door
 * where the browser allows it.
 */

export type ScreenOptions = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  /** Where relative addresses point; the page's own origin when omitted. */
  server?: string;
  url: string;
  /** Centre of the screen, in metres. */
  at: [number, number, number];
  /** Which way it faces, turned about the vertical (radians); 0 faces +z. */
  facing?: number;
  /** In metres. 1.6 by 0.9 unless you say otherwise. */
  width?: number;
  height?: number;
  /** Shown on the panel in a headset, and as the iframe's title. */
  title?: string;
  /** What pointing at it in VR does; going to the page unless you say otherwise. */
  onOpen?: (url: string) => void;
};

export type Screen = { group: THREE.Group; url: string; close: () => void };

/** Pixels the iframe is laid out at, per metre of screen. */
export const PIXELS_PER_METRE = 800;

/**
 * The address a screen may show: http(s) only, resolved against `server`.
 * Anything else (javascript:, data:, blob:) is refused, so a screen can never
 * be made to run code by what it was given.
 */
export function screenAddress(url: string, server: string): string {
  let resolved: URL;
  try {
    resolved = new URL(url, `${server.replace(/\/$/, "")}/`);
  } catch {
    throw new Error(`saha.js: openScreen was given an address it cannot read: ${url}`);
  }
  if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
    throw new Error(`saha.js: openScreen shows web pages only, not ${resolved.protocol} addresses`);
  }
  return resolved.href;
}

/** A space's name from its address, for the panel: "/s/xr.instruments/" is "xr.instruments". */
export function screenTitle(address: string): string {
  const url = new URL(address);
  return /^\/s\/([^/]+)/.exec(url.pathname)?.[1] ?? url.host;
}

/**
 * WHETHER A PAGE CAN BE SHOWN IN A FRAME HERE, decided up front rather than
 * found out from a blank rectangle. saha.ing's pages refuse to be framed by
 * anything but saha.ing itself (frame-ancestors 'self'), and a space page runs
 * sandboxed, with an origin of "null" that is never "self". So from inside a
 * space, any saha.ing address is refused; from saha.ing itself, or for another
 * site, it is worth trying.
 */
export function canFrame(address: string, pageOrigin: string, server: string): boolean {
  const target = new URL(address);
  const saha = new URL(server);
  return !(pageOrigin === "null" && target.host === saha.host);
}

/** One CSS layer per renderer, drawn after it, hidden while in a headset. */
const layers = new WeakMap<THREE.WebGLRenderer, { css: CSS3DRenderer; scene: THREE.Scene; users: number; placers: Set<() => void> }>();

function layerFor(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  const found = layers.get(renderer);
  if (found) {
    found.users += 1;
    return found;
  }
  const css = new CSS3DRenderer();
  const element = css.domElement;
  // Over the canvas, letting clicks through except on the screens themselves.
  element.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1";
  const scene = new THREE.Scene();
  const layer = { css, scene, users: 1, placers: new Set<() => void>() };
  layers.set(renderer, layer);
  const size = () => css.setSize(innerWidth, innerHeight);
  size();
  addEventListener("resize", size);
  const add = () => document.body.appendChild(element);
  if (document.body) add();
  else addEventListener("DOMContentLoaded", add, { once: true });
  // Drawn with every frame the page draws, from the camera it draws with.
  const render = renderer.render.bind(renderer);
  renderer.render = (target: THREE.Object3D, view: THREE.Camera) => {
    render(target, view);
    const inHeadset = renderer.xr.isPresenting;
    element.style.display = inHeadset ? "none" : "";
    if (inHeadset || layer.users === 0) return;
    for (const place of layer.placers) place();
    css.render(scene, view ?? camera);
  };
  return layer;
}

function panelTexture(title: string, width: number, height: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = Math.max(64, Math.round((512 * height) / width));
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#14171c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#3b82f6";
  context.lineWidth = 6;
  context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "600 40px system-ui, sans-serif";
  context.fillText(title, canvas.width / 2, canvas.height / 2 - 24, canvas.width - 40);
  context.fillStyle = "#9cc3ff";
  context.font = "400 24px system-ui, sans-serif";
  context.fillText("Point and press to open", canvas.width / 2, canvas.height / 2 + 28, canvas.width - 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function openScreen(options: ScreenOptions): Screen {
  const { scene, camera, renderer } = options;
  const server = options.server ?? (typeof location !== "undefined" ? location.origin : "https://saha.ing");
  const url = screenAddress(options.url, server);
  const width = options.width ?? 1.6;
  const height = options.height ?? 0.9;
  const title = options.title ?? screenTitle(url);

  const group = new THREE.Group();
  group.name = `saha:screen ${title}`;
  group.position.set(...options.at);
  group.rotation.y = options.facing ?? 0;
  scene.add(group);

  // The panel: what a headset sees, and the back of the screen on a computer.
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: panelTexture(title, width, height), side: THREE.DoubleSide }),
  );
  panel.name = "saha:screen-panel";
  group.add(panel);

  // Pointing at it in a headset opens it; so does "Go there" on a computer.
  const open = options.onOpen ?? ((address: string) => location.assign(address));

  // The live page, on a computer, under a title bar that can always take you
  // there. Where the page cannot be framed (canFrame), a card says so instead
  // of an empty rectangle (Sill, 6468: "the page name and a go-there button").
  const layer = layerFor(renderer, camera);
  const widthPx = Math.round(width * PIXELS_PER_METRE);
  const heightPx = Math.round(height * PIXELS_PER_METRE);
  // Two boxes: CSS3DRenderer rewrites `display` on the element it places every
  // frame (to show or hide it), which would undo a flex layout on it.
  const holder = document.createElement("div");
  holder.style.cssText = `width:${widthPx}px;height:${heightPx}px;pointer-events:auto`;
  const frame = document.createElement("div");
  holder.append(frame);
  frame.style.cssText = `width:${widthPx}px;height:${heightPx}px;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:#14171c;pointer-events:auto;font:600 28px system-ui,sans-serif;color:#fff`;
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 18px;background:#1f2430";
  const name = document.createElement("span");
  name.textContent = title;
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Go there";
  go.style.cssText = "border:0;border-radius:999px;padding:8px 20px;background:#3b82f6;color:#fff;font:600 24px system-ui,sans-serif;cursor:pointer";
  go.addEventListener("click", () => open(url));
  bar.append(name, go);
  frame.append(bar);
  const pageOrigin = typeof self !== "undefined" ? self.origin : "null";
  if (canFrame(url, pageOrigin, server)) {
    const inner = document.createElement("iframe");
    inner.src = url;
    inner.title = title;
    // The page is somebody else's: it runs, but never as this page's origin.
    inner.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-pointer-lock allow-downloads");
    inner.setAttribute("allow", "xr-spatial-tracking; fullscreen; autoplay");
    inner.style.cssText = "flex:1;width:100%;border:0;background:#fff";
    frame.append(inner);
  } else {
    const card = document.createElement("div");
    card.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center";
    const line = document.createElement("div");
    line.textContent = "This page can't be shown inside a space yet.";
    const hint = document.createElement("div");
    hint.textContent = "Press Go there to visit it.";
    hint.style.cssText = "font-weight:400;color:#9cc3ff";
    card.append(line, hint);
    frame.append(card);
  }
  const live = new CSS3DObject(holder);
  live.scale.setScalar(1 / PIXELS_PER_METRE);
  layer.scene.add(live);
  const place = () => {
    group.updateMatrixWorld();
    live.position.setFromMatrixPosition(group.matrixWorld);
    live.quaternion.setFromRotationMatrix(group.matrixWorld);
  };
  place();
  layer.placers.add(place);

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const rays = [0, 1].map((index) => renderer.xr.getController(index));
  const onSelect = (event: { target: THREE.Object3D }) => {
    if (!renderer.xr.isPresenting) return;
    event.target.getWorldPosition(origin);
    direction.set(0, 0, -1).applyQuaternion(event.target.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(origin, direction);
    if (raycaster.intersectObject(panel, false).length) open(url);
  };
  for (const ray of rays) ray.addEventListener("select", onSelect as never);

  return {
    group,
    url,
    close: () => {
      layer.placers.delete(place);
      for (const ray of rays) ray.removeEventListener("select", onSelect as never);
      layer.scene.remove(live);
      holder.remove();
      layer.users -= 1;
      scene.remove(group);
      panel.geometry.dispose();
      (panel.material as THREE.MeshBasicMaterial).map?.dispose();
      (panel.material as THREE.MeshBasicMaterial).dispose();
    },
  };
}
