import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { BenchPiece } from "../../shared/space-bench";
import { bff } from "../bff-client";
import { connectSaha, type SahaRoom } from "../kit/connect";
import { makeTextPlane, webAudio } from "../kit/pieces/browser";
import { PieceHost } from "../kit/pieces/host";
import { pieceState, pieceSync } from "../kit/pieces/sync";
import { base } from "../router";

/**
 * A LIVE PIECE ON THE WORKBENCH (shared/piece-wire.ts): the space's own code,
 * running here in the saha.ing room, in VR, for everyone standing here. It
 * runs in a sandboxed worker and only describes what to draw; this page draws
 * it, and tells it who pressed what.
 *
 * Its values and moments are the SPACE'S (src/kit/pieces/sync.ts): the room
 * joins the space's hub as an unseen seat, so the drums here and the drums in
 * the space's own page are one set of drums.
 */

const noRaycast = () => undefined;

/**
 * The space's hub, for the pieces on this room's bench: undefined while
 * connecting, null when there is none to be had (no ticket: the pieces still
 * run, each for whoever is looking).
 */
export function useSpaceHub(space: string, wanted: boolean): SahaRoom | null | undefined {
  const [hub, setHub] = useState<SahaRoom | null | undefined>(wanted ? undefined : null);
  useEffect(() => {
    if (!wanted) {
      setHub(null);
      return;
    }
    let alive = true;
    let room: SahaRoom | null = null;
    setHub(undefined);
    // A hub that has not answered in five seconds is not waited for any longer.
    const patience = setTimeout(() => {
      if (alive) setHub((now) => (now === undefined ? null : now));
    }, 5000);
    bff.spaceTicket(space)
      .then((answer) => {
        if (!alive) return;
        room = connectSaha({ server: `${location.origin}${base}`, href: location.href, space, ticket: answer.ticket, unseen: true });
        room.on("ready", () => {
          if (alive) setHub(room);
        });
      })
      .catch(() => {
        if (alive) setHub(null);
      });
    return () => {
      alive = false;
      clearTimeout(patience);
      room?.leave();
    };
  }, [space, wanted]);
  return hub;
}

function loadPieceModel(url: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader.loadAsync(url).then((gltf) => gltf.scene);
}

export function LivePiece({ piece, url, space, hub }: { piece: BenchPiece; url: string; space: string; hub: SahaRoom | null | undefined }) {
  const holder = useRef<THREE.Group>(null);
  const host = useRef<PieceHost | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    // Wait for the hub, or for knowing there is none, so the piece starts with its state.
    if (hub === undefined || !holder.current) return;
    setProblem(null);
    const sync = hub ? pieceSync(hub, piece.id) : null;
    const running = new PieceHost({
      url: new URL(`${base}${url}`, location.origin).href,
      space,
      env: "room",
      you: hub?.you ? { id: hub.you.id, name: hub.you.name } : null,
      state: hub ? pieceState(hub.state, piece.id) : {},
      share: sync?.share ?? { set: () => undefined, emit: () => undefined },
      loadModel: loadPieceModel,
      makeText: makeTextPlane,
      audio: webAudio(),
      onLog: (text) => console.info(`[${space}/${piece.id}]`, text),
      onProblem: setProblem,
      onChange: invalidate,
    });
    holder.current.add(running.group);
    host.current = running;
    const detach = sync?.attach(running);
    // A page that draws on demand still needs the watchdog's ping each second.
    const beat = setInterval(invalidate, 1000);
    return () => {
      clearInterval(beat);
      detach?.();
      running.stop();
      host.current = null;
    };
  }, [url, hub, piece.id, space, invalidate]);

  useFrame((_, delta) => host.current?.tick(Math.min(delta, 0.1)));

  return (
    <group>
      <group
        ref={holder}
        onClick={(event) => {
          const running = host.current;
          const you = hub?.you ? { id: hub.you.id, name: hub.you.name } : null;
          if (running?.press(event.object, you, "pointer", event.point)) event.stopPropagation();
        }}
      />
      {problem ? (
        <Text position={[0, 0.25, 0.26]} fontSize={0.03} color="#f0a0a0" maxWidth={0.7} textAlign="center" anchorY="bottom" raycast={noRaycast}>
          {problem}
        </Text>
      ) : null}
    </group>
  );
}
