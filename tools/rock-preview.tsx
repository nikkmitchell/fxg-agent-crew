// An offline, read-only fixture. It never signs in or changes a room table.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import { RockForm } from "../src/space/RockForm";
import { RoomItems } from "../src/space/RoomItems";
import { GO_SURFACE_LOOKS } from "../src/space/go-surfaces";
import { GO_SIZES, defaultGoItem, type GoSize } from "../shared/room-items";
import { GO_SURFACE, goBoardWidth, goExtent, goPoint } from "../shared/go-layout";

function Preview() {
  const [size, setSize] = useState<GoSize>(19), [table, setTable] = useState(false);
  const [view, setView] = useState("player");
  const width = goBoardWidth(size), look = GO_SURFACE_LOOKS.rock;
  const item = { ...defaultGoItem("offline-rock-preview"), size, surface: "rock" as const,
    position: { x: 0, y: 0, z: 0, rotationY: 0 },
    stones: [{ x: 2, y: 2, colour: 0 }, { x: size - 3, y: size - 3, colour: 1 }] };
  const extent = goExtent(size);
  return <><header><small>SAHA / MATERIAL STUDY</small><h1>A stone shaped by water</h1>
    <p>ROCK · {size} × {size} · drag to orbit, scroll to inspect</p>
    {GO_SIZES.map((s) => <button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>{s} × {s}</button>)}
    <button aria-pressed={table} onClick={() => setTable(!table)}>Full table</button>
    {["player", "low", "top"].map((v) => <button key={v} aria-pressed={v === view} onClick={() => setView(v)}>{v}</button>)}
  </header><Canvas key={`${view}-${size}-${table}`} shadows dpr={[1, 2]} camera={{ fov: 38,
    position: view === "top" ? [0, 0.8 + width * 2.8, 0.01] : view === "low" ? [width * 1.4, 1.02, width * 1.7] : [width * 1.25, 0.9 + width * 1.15, width * 1.6] }}
    gl={{ antialias: true, preserveDrawingBuffer: true }}>
    <color attach="background" args={["#171b1f"]} />
    <hemisphereLight args={["#e3eaf2", "#4d443a", 1.8]} />
    <directionalLight position={[-2, 5, 3]} intensity={3.2} color="#fff0d9" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0001} />
    <directionalLight position={[3, 2, -3]} intensity={1.7} color="#b1c9e1" />
    {table ? <RoomItems items={[item]} reducedMotion /> : <group>
      <RockForm size={size} top={look.base} side={look.rim} />
      {Array.from({ length: size }, (_, i) => <group key={i}>
        <mesh rotation-x={-Math.PI / 2} position={[goPoint(i, size), GO_SURFACE + 0.0015, 0]}><planeGeometry args={[0.0025, extent]}/><meshBasicMaterial color={look.lines}/></mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, GO_SURFACE + 0.0015, goPoint(i, size)]}><planeGeometry args={[extent, 0.0025]}/><meshBasicMaterial color={look.lines}/></mesh>
      </group>)}
    </group>}
    {!table && <ContactShadows position={[0, 0.741, 0]} opacity={0.55} scale={width + 1.2} blur={1.6} far={0.3} resolution={512} frames={1} />}
    <OrbitControls target={[0, 0.8, 0]} minDistance={0.25} maxDistance={12} />
  </Canvas><footer>Production rock geometry · flat playing surface · connected grottoes · no room connection</footer></>;
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(<Preview />);
