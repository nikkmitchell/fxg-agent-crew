import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { SharedDawn } from "./SharedDawn";

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const clock = useMemo(() => {
    const requested = params.get("at");
    const epoch = requested ? Date.parse(requested) : Date.now();
    const started = performance.now();
    return () => epoch + performance.now() - started;
  }, []);
  const reducedMotion = params.get("reduced") === "1";
  return (
    <Canvas camera={{ position: [0, 1.6, 6.2], fov: 70, near: 0.1, far: 60 }}>
      <color attach="background" args={["#0b0d12"]} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} />
      <SharedDawn reducedMotion={reducedMotion} active now={clock} />
      <mesh position={[0, 1.2, 0]}>
        <sphereGeometry args={[0.8, 40, 32]} />
        <meshStandardMaterial color="#b8b6b1" roughness={0.82} />
      </mesh>
      <mesh position={[-1.4, 0.6, -0.2]}>
        <boxGeometry args={[0.75, 1.2, 0.55]} />
        <meshStandardMaterial color="#85878b" roughness={0.9} />
      </mesh>
      <mesh position={[1.4, 0.5, 0.1]}>
        <boxGeometry args={[0.8, 1, 0.7]} />
        <meshStandardMaterial color="#9a8f7f" roughness={0.87} />
      </mesh>
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Preview /></StrictMode>);
