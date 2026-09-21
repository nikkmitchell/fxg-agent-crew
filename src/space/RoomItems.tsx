import { useMemo, useRef } from "react";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { GoRoomItem, RoomItem } from "../../shared/room-items";
import { space } from "../space-client";

function GoTable({ item }: { item: GoRoomItem }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const extent = 1.22;
  const step = extent / (item.size - 1);
  const lines = useMemo(() => Array.from({ length: item.size }, (_, index) => -extent / 2 + index * step), [item.size, step]);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 0.65 + Math.sin(clock.elapsedTime * 4) * 0.35;
  });
  const point = (n: number) => -extent / 2 + n * step;
  const bowlPosition = (index: number): [number, number, number] => {
    const angle = (index / item.colours.length) * Math.PI * 2 + Math.PI / 2;
    return [Math.cos(angle) * 0.94, 0.86, Math.sin(angle) * 0.94];
  };
  return (
    <group position={[item.position.x, 0, item.position.z]} rotation-y={item.position.rotationY}>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.92, 0.8, 0.72, 8]} />
        <meshStandardMaterial color="#39261c" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.77, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.48, 0.1, 1.48]} />
        <meshStandardMaterial color="#c79855" roughness={0.56} />
      </mesh>
      {lines.map((offset, index) => (
        <group key={index}>
          <mesh position={[offset, 0.826, 0]} rotation-x={Math.PI / 2}>
            <planeGeometry args={[0.008, extent]} /><meshBasicMaterial color="#51351f" />
          </mesh>
          <mesh position={[0, 0.827, offset]} rotation-x={Math.PI / 2}>
            <planeGeometry args={[extent, 0.008]} /><meshBasicMaterial color="#51351f" />
          </mesh>
        </group>
      ))}
      {Array.from({ length: item.size * item.size }, (_, index) => {
        const x = index % item.size; const y = Math.floor(index / item.size);
        return <mesh key={`hit-${index}`} position={[point(x), 0.845, point(y)]} rotation-x={-Math.PI / 2}
          onClick={(event) => { event.stopPropagation(); void space.actOnGo(item.id, { action: "place", x, y }); }}>
          <circleGeometry args={[Math.max(0.025, step * 0.38), 12]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>;
      })}
      {item.stones.map((stone, index) => (
        <mesh key={`${stone.x}-${stone.y}-${index}`} position={[point(stone.x), 0.86, point(stone.y)]} castShadow>
          <sphereGeometry args={[Math.min(0.055, step * 0.42), 22, 10]} /><meshStandardMaterial color={item.colours[stone.colour]} roughness={0.28} />
        </mesh>
      ))}
      {item.colours.map((colour, index) => {
        const position = bowlPosition(index); const active = index === item.activeColour;
        return <group key={colour} position={position} onClick={(event) => { event.stopPropagation(); if (active) void space.actOnGo(item.id, { action: "lift" }); }}>
          <mesh castShadow><cylinderGeometry args={[0.16, 0.12, 0.09, 24]} /><meshStandardMaterial color="#6b4328" roughness={0.68} /></mesh>
          <mesh position={[0, 0.055, 0]} castShadow><sphereGeometry args={[0.095, 20, 10]} />
            <meshStandardMaterial ref={active ? glow : undefined} color={colour} emissive={active ? colour : "#000000"} emissiveIntensity={active ? 0.8 : 0} roughness={0.25} />
          </mesh>
          {item.liftedColour === index && <mesh position={[0, 0.25, 0]} castShadow><sphereGeometry args={[0.06, 22, 10]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.3} /></mesh>}
        </group>;
      })}
      <Text position={[0, 0.48, -0.91]} rotation={[0, 0, 0]} fontSize={0.09} color="#f1d8aa" anchorX="center" anchorY="middle">
        {`GO  ${item.size}×${item.size}`}
      </Text>
    </group>
  );
}

export function RoomItems({ items }: { items: RoomItem[] }) {
  return <>{items.map((item) => item.kind === "go" ? <GoTable key={item.id} item={item} /> : null)}</>;
}
