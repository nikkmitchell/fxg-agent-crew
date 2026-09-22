// Development-only visual fixture: uses the production table and real local BFF actions.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { RoomItems } from "../src/space/RoomItems";
import { space } from "../src/space-client";
import type { RoomItem } from "../shared/room-items";
function Preview() {
  const [items, setItems] = useState<RoomItem[]>([]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const read = () => fetch("/bff/space/items").then((r) => r.json()).then((data) => setItems(data.items ?? []));
    void read(); const timer = setInterval(read, 250); return () => clearInterval(timer);
  }, []);
  const item = items[0];
  return <><header><h1>Go · a table for the room</h1><p>{item ? `${item.size}×${item.size} · turn ${item.activeColour} · ${item.stones.length} stones · ${item.captures.length} captured · ${item.liftedColour === null ? "in bowl" : "in flight"}` : "No local table"}</p>
    {[5, 9, 19, 25].map((size) => <button key={size} onClick={() => item && space.configureGo(item.id, { size: size as 5 | 9 | 19 | 25 })}>{size}×{size}</button>)}
    <button onClick={() => setReduced(!reduced)}>{reduced ? "Reduced motion" : "Motion on"}</button>
  </header><Canvas camera={{ fov: 42, position: [-0.4, 3.4, 4] }} onCreated={({ camera }) => camera.lookAt(0, 0.6, 0)} gl={{ antialias: true }}>
    <color attach="background" args={["#10151c"]} /><hemisphereLight args={["#ffffff", "#2a3040", 2.2]} /><directionalLight position={[3, 6, 4]} intensity={1.4} />
    <RoomItems items={items.map((one) => ({ ...one, position: { x: 0, y: 0, z: 0, rotationY: 0 } }))} reducedMotion={reduced} inHeadset={false} />
    <OrbitControls target={[0, 0.6, 0]} />
  </Canvas></>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
