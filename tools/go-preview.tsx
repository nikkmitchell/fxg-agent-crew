// Development-only visual fixture: uses the production table and real local BFF actions.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Vector3 } from "three";
import { RoomItems } from "../src/space/RoomItems";
import { space } from "../src/space-client";
import type { RoomItem } from "../shared/room-items";
function Preview() {
  const [items, setItems] = useState<RoomItem[]>([]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const target = window as Window & { render_game_to_text?: () => string };
    target.render_game_to_text = () => JSON.stringify({ coordinates: "grid x/y are zero-based columns/rows; world Y is up", items });
    return () => { delete target.render_game_to_text; };
  }, [items]);
  useEffect(() => {
    const read = () => fetch("/bff/space/items").then((r) => r.json()).then((data) => setItems(data.items ?? []));
    void read(); const timer = setInterval(read, 250); return () => clearInterval(timer);
  }, []);
  const item = items[0];
  return <><header><h1>Go · a table for the room</h1><p>{item ? `${item.size}×${item.size} · turn ${item.activeColour} · ${item.stones.length} stones · ${item.captures.length} captured · ${item.liftedColour === null ? "in bowl" : "in flight"}` : "No local table"}</p>
    {!item && <button id="local-sign-in" onClick={() => void fetch("/dev/as/nikk")}>Local harness sign-in</button>}
    {[5, 9, 19, 25].map((size) => <button key={size} onClick={() => item && space.configureGo(item.id, { size: size as 5 | 9 | 19 | 25 })}>{size}×{size}</button>)}
    <button onClick={() => setReduced(!reduced)}>{reduced ? "Reduced motion" : "Motion on"}</button>
  </header><Canvas camera={{ fov: 42, position: [-0.4, 3.4, 4] }} onCreated={({ camera }) => {
    camera.lookAt(0, 0.6, 0);
    // Read-only projection for genuine browser clicks, never action-handler calls.
    (window as Window & { goPreviewProject?: (point: number[]) => number[] }).goPreviewProject = ([x, y, z]) => {
      const p = new Vector3(x + 1.15, y, z - 1.8).project(camera);
      return [(p.x + 1) * innerWidth / 2, (1 - p.y) * innerHeight / 2];
    };
  }} gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={["#10151c"]} /><hemisphereLight args={["#ffffff", "#2a3040", 2.2]} /><directionalLight position={[3, 6, 4]} intensity={1.4} />
    <group position={[1.15, 0, -1.8]}><RoomItems items={items} reducedMotion={reduced} /></group>
    <OrbitControls target={[0, 0.6, 0]} />
  </Canvas></>;
}
if (location.hostname === "127.0.0.1" && new URLSearchParams(location.search).get("local") === "1") await fetch("/dev/as/nikk");
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Preview />);
