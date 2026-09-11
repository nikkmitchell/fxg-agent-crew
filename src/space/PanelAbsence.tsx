import { useMemo } from "react";
import * as THREE from "three";
import { STATIONS } from "../../shared/space-layout";
import { makeLabelTexture } from "./label-texture";

/**
 * What stands where a panel would be, inside a headset.
 *
 * The panels are live web pages — DOM composited over the WebGL canvas by the
 * browser. An immersive session presents the framebuffer alone, so they are not
 * there and cannot be. Nikk put on a Quest, got a session, looked around, and
 * found three empty spaces with nothing to explain them; the only way to learn
 * why was to ask me.
 *
 * So the absence says what it is. This is the same rule the rest of the product
 * keeps — an empty state that explains itself beats a blank one — and it is
 * cheap: three quads with text baked into a canvas texture, drawn in WebGL, so
 * they survive in a session precisely because they are not DOM.
 */

const LINES = [
  "This panel is a live web page.",
  "A headset session cannot show one:",
  "it draws 3D only, and a page is not 3D.",
  "Open the room in a browser window to use it.",
];

/** One frame's worth of text, baked once. */
function useNoticeTexture(title: string): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 640;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.fillStyle = "#141822";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#39405260";
    context.lineWidth = 6;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);

    context.textAlign = "center";
    context.fillStyle = "#e8e4d9";
    context.font = "600 62px ui-sans-serif, system-ui, sans-serif";
    context.fillText(title, canvas.width / 2, 150);

    context.fillStyle = "#9aa2b4";
    context.font = "400 38px ui-sans-serif, system-ui, sans-serif";
    LINES.forEach((line, index) => {
      context.fillText(line, canvas.width / 2, 270 + index * 60);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [title]);
}

function Notice({ station }: { station: (typeof STATIONS)[string] }) {
  const texture = useNoticeTexture(station.label);
  if (!texture) return null;
  return (
    <mesh
      position={[station.surface.position.x, station.surface.position.y, station.surface.position.z]}
      rotation={[0, station.surface.rotationY, 0]}
    >
      <planeGeometry args={[station.surface.width, station.surface.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

export function PanelAbsence() {
  return (
    <group>
      {Object.values(STATIONS).map((station) => (
        <Notice key={station.id} station={station} />
      ))}
    </group>
  );
}
