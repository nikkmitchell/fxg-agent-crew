import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { buttonInk, uiPixels, type UiState } from "../../../shared/thing-ui";
import { drawInk, measureWith } from "../../engine/ink-canvas";
import { claimPointer } from "../pointer-claim";
import { placeInFront } from "./question-form";
import { closeReviewView, useReviewView } from "./review-view";
import { onArrival } from "../arrival";

const WIDTH = 0.7;
const HEIGHT = 0.1;

/**
 * THE WAY BACK from a review's version opened for you alone (review-view.ts):
 * one button in the platform's look, put in front of you when the version
 * opens, and there until you press it. The version's own thing may have
 * replaced the Studio that opened it, so the way back is the room's, not a
 * thing's.
 */
export function ReviewBack() {
  const view = useReviewView();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [state, setState] = useState<UiState>("rest");
  // Placed again whenever you are moved: the version's own spawn arrives after it opens, and Back must be in
  // front of where you then stand, not where you were (Mica 7461).
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => onArrival(() => requestAnimationFrame(() => setArrivals((n) => n + 1))), []);
  const place = useMemo(() => (view ? placeInFront(camera, gl) : null), [view, camera, gl, arrivals]);
  const surface = useMemo(() => {
    const px = uiPixels(WIDTH, HEIGHT);
    const canvas = Object.assign(document.createElement("canvas"), { width: px.width, height: px.height });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { px, canvas, texture };
  }, []);
  useEffect(() => () => surface.texture.dispose(), [surface]);
  useEffect(() => {
    if (!view) return;
    const context = surface.canvas.getContext("2d");
    if (!context) return;
    const label = `Back · leave ${view.title} (${view.variant})`;
    drawInk(surface.canvas, buttonInk({ label, tone: "accent", state, width: surface.px.width, height: surface.px.height }, measureWith(context, "bold")));
    surface.texture.needsUpdate = true;
    invalidate();
  }, [view, state, surface, invalidate]);
  if (!view || !place) return null;
  return (
    <mesh
      position={place.at.clone().setY(place.at.y - 0.25)}
      rotation-y={place.yaw}
      onPointerOver={() => setState("hover")}
      onPointerOut={() => setState("rest")}
      onPointerDown={(event) => {
        event.stopPropagation();
        claimPointer(event.nativeEvent);
        setState("pressed");
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        setState("rest");
        closeReviewView();
      }}
    >
      <planeGeometry args={[WIDTH, HEIGHT]} />
      <meshBasicMaterial map={surface.texture} transparent alphaTest={0.02} toneMapped={false} />
    </mesh>
  );
}
