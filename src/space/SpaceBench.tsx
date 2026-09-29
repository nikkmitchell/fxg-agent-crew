import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { BENCH_AT, benchSlot, type BenchPiece } from "../../shared/space-bench";
import type { ServerMessage } from "../../shared/space-wire";
import { ROOM } from "../../shared/space-layout";
import { spaceKey } from "../../shared/spaces";
import { requestJson } from "../api-request";
import { bff } from "../bff-client";
import { base } from "../router";
import { WristButton } from "./Backdrop";

/**
 * THE WORKBENCH (shared/space-bench.ts): the pieces a room's space lists in
 * its saha-pieces.json, on pedestals in the saha.ing room of the same name,
 * reloaded for everyone here within seconds of each push.
 *
 * Models and pictures are loaded into this room; pages are portals, because a
 * page is the team's code and must never run inside saha.ing's own page.
 * Nothing at all is drawn in a room whose space lists no pieces.
 */

type Bench = {
  space: string;
  branch: string;
  deploy: { id: string; commit: string; message: string; pushedBy: string; createdAt: string } | null;
  pieces: (BenchPiece & { url: string })[];
  problems: string[];
};

const noRaycast = () => undefined;
const facing = Math.atan2(ROOM.spawn.x - BENCH_AT.x, ROOM.spawn.z - BENCH_AT.z);
/** Everything on a pedestal is scaled to fit a cube this big. */
const FIT = 0.5;

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

function dispose(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

/** One .glb/.gltf, fitted onto its pedestal; a new URL (a new push) replaces it. */
function BenchModel({ url, spin }: { url: string; spin: boolean }) {
  const holder = useRef<THREE.Group>(null);
  const [failed, setFailed] = useState(false);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    let current: THREE.Object3D | null = null;
    let alive = true;
    setFailed(false);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(
      url,
      (gltf) => {
        if (!alive || !holder.current) {
          dispose(gltf.scene);
          return;
        }
        const model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const scale = FIT / Math.max(size.x, size.y, size.z, 1e-3);
        const centre = box.getCenter(new THREE.Vector3());
        model.scale.setScalar(scale);
        // Sit on the pedestal: centred across, bottom on the top.
        model.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
        model.traverse((child) => { child.raycast = noRaycast; });
        current = model;
        holder.current.add(model);
        invalidate();
      },
      undefined,
      () => { if (alive) setFailed(true); },
    );
    return () => {
      alive = false;
      if (current) {
        current.parent?.remove(current);
        dispose(current);
      }
    };
  }, [url, invalidate]);

  useFrame((_, delta) => {
    if (spin && holder.current) holder.current.rotation.y += delta * 0.4;
  });

  return (
    <group ref={holder}>
      {failed ? (
        <Text position={[0, 0.2, 0]} fontSize={0.05} color="#e88" maxWidth={0.5} textAlign="center" raycast={noRaycast}>could not load</Text>
      ) : null}
    </group>
  );
}

/** A picture on a small stand, its own shape. */
function BenchImage({ url }: { url: string }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (value) => {
      value.colorSpace = THREE.SRGBColorSpace;
      if (alive) {
        loaded = value;
        setTexture(value);
      } else value.dispose();
    });
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [url]);
  if (!texture) return null;
  const image = texture.image as { width: number; height: number };
  const aspect = image.width / Math.max(1, image.height);
  const [width, height] = aspect >= 1 ? [FIT, FIT / aspect] : [FIT * aspect, FIT];
  return (
    <mesh position={[0, height / 2 + 0.02, 0]} raycast={noRaycast}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export function SpaceBench({ room, subscribe }: {
  room: string;
  subscribe: (listener: (message: ServerMessage) => void) => () => void;
}) {
  const space = spaceKey(room);
  const [bench, setBench] = useState<Bench | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    requestJson<Bench>(`${base}/bff/spaces/${encodeURIComponent(space)}/bench`)
      .then(setBench)
      // No space for this room, or not ours to see: no bench, silently.
      .catch(() => setBench(null));
  }, [space]);
  useEffect(load, [load]);
  useEffect(() => subscribe((message) => {
    if (message.type === "benchChanged" && message.space === space) load();
  }), [subscribe, space, load]);

  if (!bench || (bench.pieces.length === 0 && bench.problems.length === 0)) return null;

  const openPage = (piece: BenchPiece) => {
    setNotice(`Opening ${piece.name}…`);
    bff.spaceTicket(space)
      .then((answer) => {
        const root = bench.branch === "main" ? `/s/${space}/` : `/s/${space}/@${bench.branch}/`;
        window.location.assign(`${base}${root}${piece.path}#saha=${encodeURIComponent(answer.ticket)}`);
      })
      .catch((error: unknown) => setNotice(error instanceof Error ? error.message : `Could not open ${piece.name}.`));
  };

  const heading = bench.deploy
    ? `${space} · ${bench.branch} · ${bench.deploy.commit.slice(0, 7)} by ${bench.deploy.pushedBy}, ${ago(bench.deploy.createdAt)}`
    : `${space} · ${bench.branch} · nothing pushed yet`;
  const footer = notice ?? (bench.problems.length ? `saha-pieces.json: ${bench.problems[0]}${bench.problems.length > 1 ? ` (+${bench.problems.length - 1} more)` : ""}` : null);

  return (
    <group position={[BENCH_AT.x, 0, BENCH_AT.z]} rotation={[0, facing, 0]}>
      <WristButton label={`WORKBENCH\n${heading}`} y={1.95} width={2.6} height={0.2} lines={2} tone="muted" passThrough onTap={() => {}} />
      {bench.pieces.map((piece, index) => {
        const slot = benchSlot(index);
        return (
          <group key={piece.id} position={[slot.x, 0, -slot.z]}>
            {/* The pedestal. */}
            <mesh position={[0, slot.height / 2, 0]} raycast={noRaycast}>
              <cylinderGeometry args={[0.2, 0.24, slot.height, 24]} />
              <meshStandardMaterial color="#3a3f47" roughness={0.8} />
            </mesh>
            <Text position={[0, slot.height - 0.06, 0.25]} fontSize={0.045} color="#e9edf2" anchorY="top" maxWidth={0.6} textAlign="center" raycast={noRaycast}>
              {piece.name}
            </Text>
            <group position={[0, slot.height, 0]}>
              {piece.kind === "model" ? <BenchModel url={piece.url} spin={piece.spin} /> : null}
              {piece.kind === "image" ? <BenchImage url={piece.url} /> : null}
              {piece.kind === "page" ? (
                <WristButton label={`▶ ${piece.name}\nOPEN (a page)`} y={0.2} width={0.62} height={0.26} lines={2} onTap={() => openPage(piece)} />
              ) : null}
            </group>
          </group>
        );
      })}
      {footer ? (
        <group position={[0, 0, 0.5]}>
          <WristButton label={footer} y={0.35} width={2.6} height={0.12} tone="muted" passThrough onTap={() => {}} />
        </group>
      ) : null}
    </group>
  );
}
