import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GO_RISKS, GO_STYLES, type GoPlayCard, type GoRoomItem, type GoRisk, type GoStyle, type RoomItem } from "../../shared/room-items";
import { space } from "../space-client";

function GoTable({ item, actorId }: { item: GoRoomItem; actorId: string | null }) {
  const glow = useRef<THREE.MeshStandardMaterial>(null);
  const [seat, setSeat] = useState(-1);
  const [card, setCard] = useState<GoPlayCard | null>(null);
  const [notice, setNotice] = useState("");
  const extent = 1.22;
  const step = extent / (item.size - 1);
  const lines = useMemo(() => Array.from({ length: item.size }, (_, index) => -extent / 2 + index * step), [item.size, step]);
  useFrame(({ clock }) => {
    if (glow.current) glow.current.emissiveIntensity = 0.65 + Math.sin(clock.elapsedTime * 4) * 0.35;
  });
  useEffect(() => {
    let live = true;
    if (actorId) void space.goPlayer(item.id).then((profile) => {
      if (!live) return;
      setSeat(profile.seat);
      setCard(profile.card);
    }).catch(() => undefined);
    else { setSeat(-1); setCard(null); }
    return () => { live = false; };
  }, [actorId, item.id, item.mode, item.seats]);
  const chooseStyle = async (style: GoStyle) => {
    if (!actorId) return;
    const next = { style, risk: card?.risk ?? "balanced", signature: card?.signature ?? "" } satisfies GoPlayCard;
    try {
      await space.setGoPlayer(item.id, { action: "card", card: next });
      setCard(next); setNotice("");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const chooseRisk = async (risk: GoRisk) => {
    if (!actorId || !card) return;
    const next = { ...card, risk };
    try {
      await space.setGoPlayer(item.id, { action: "card", card: next });
      setCard(next); setNotice("");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const chooseMode = async (mode: "open" | "roles") => {
    try {
      await space.setGoPlayer(item.id, { action: "mode", mode });
      setSeat(-1); setNotice(mode === "open" ? "Open play: pick up the glowing stone to claim one turn." : "Color roles: choose a bowl; your avatar stays free to move.");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const addBowl = async () => {
    try {
      const { item: next } = await space.configureGo(item.id, { addBowl: true });
      setNotice(`Stone bowl ${next.colours.length} added. ${item.mode === "roles" ? "Choose it to claim that color." : "Open turns stay unassigned."}`);
    } catch (error) { setNotice(messageOf(error)); }
  };
  const restart = async () => {
    try {
      await space.configureGo(item.id, { size: item.size });
      setNotice("Fresh board ready. Keep your colors and choose a new opening.");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const playStyleMove = async () => {
    try {
      const result = await space.playGo(item.id, item.moveNumber, { action: "suggest" });
      setNotice(result.suggestion ? `${result.suggestion.style}: ${result.suggestion.reason}` : "Move played.");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const pass = async () => {
    try {
      const { item: next } = await space.playGo(item.id, item.moveNumber, { action: "pass" });
      setNotice(next.score ? `Game complete · ${scoreSummary(next)}` : "Passed.");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const returnStone = async () => {
    try {
      await space.actOnGo(item.id, { action: "return", expectedMoveNumber: item.moveNumber });
      setNotice("Stone returned. Board and turn are unchanged, ready whenever you come back.");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const stand = async () => {
    try {
      await space.setGoPlayer(item.id, { action: "stand" });
      setSeat(-1); setNotice("");
    } catch (error) { setNotice(messageOf(error)); }
  };
  const point = (n: number) => -extent / 2 + n * step;
  const sameActor = (left: string | null, right: string | null) => Boolean(left && right && left.toLocaleLowerCase("en-US") === right.toLocaleLowerCase("en-US"));
  const canTakeTurn = item.mode === "open"
    ? (!item.turnActor || sameActor(item.turnActor, actorId))
    : seat === item.activeColour;
  const canReturnStone = Boolean(actorId && item.liftedColour === item.activeColour &&
    (item.mode === "open" ? sameActor(item.turnActor, actorId) : seat === item.activeColour));
  const canChooseSetup = item.moveNumber === 0 && !item.turnActor && item.liftedColour === null;
  const canUseCard = Boolean(actorId && canTakeTurn && card && card.style !== "observer" && !item.gameOver);
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
          onClick={(event) => { event.stopPropagation(); void space.actOnGo(item.id, { action: "place", x, y, expectedMoveNumber: item.moveNumber }).catch((error) => setNotice(messageOf(error))); }}>
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
        return <group key={colour} position={position} onClick={(event) => {
          event.stopPropagation();
          const owner = item.seats[index];
          if (item.mode === "open" && actorId && active && canTakeTurn && !item.gameOver) {
            void space.actOnGo(item.id, { action: "lift", expectedMoveNumber: item.moveNumber }).then(() => setNotice("Your turn is claimed. Place a stone on the board."))
              .catch((error) => setNotice(messageOf(error)));
          } else if (item.mode === "roles" && actorId && seat < 0 && !owner) {
            void space.setGoPlayer(item.id, { action: "sit", colour: index }).then((answer) => {
              setSeat(answer.seat ?? index); setNotice("");
            }).catch((error) => setNotice(messageOf(error)));
          } else if (item.mode === "roles" && active && seat === index && !item.gameOver) {
            void space.actOnGo(item.id, { action: "lift", expectedMoveNumber: item.moveNumber }).catch((error) => setNotice(messageOf(error)));
          }
        }}>
          <mesh castShadow><cylinderGeometry args={[0.16, 0.12, 0.09, 24]} /><meshStandardMaterial color="#6b4328" roughness={0.68} /></mesh>
          <mesh position={[0, 0.055, 0]} castShadow><sphereGeometry args={[0.095, 20, 10]} />
            <meshStandardMaterial ref={active ? glow : undefined} color={colour} emissive={active ? colour : "#000000"} emissiveIntensity={active ? 0.8 : 0} roughness={0.25} />
          </mesh>
          {item.liftedColour === index && <mesh position={[0, 0.25, 0]} castShadow><sphereGeometry args={[0.06, 22, 10]} /><meshStandardMaterial color={colour} emissive={colour} emissiveIntensity={0.3} /></mesh>}
          {item.seats[index] && <Text position={[0, -0.13, 0]} fontSize={0.045} color="#f1d8aa" anchorX="center" anchorY="middle">{item.seats[index].slice(0, 16)}</Text>}
          {item.mode === "open" && active && item.turnActor && <Text position={[0, -0.13, 0]} fontSize={0.04} color="#f1d8aa" anchorX="center" anchorY="middle">{item.turnActor.slice(0, 16)}</Text>}
        </group>;
      })}
      {actorId && <group>
        {(["open", "roles"] as const).map((mode, index) => {
          const selected = item.mode === mode;
          return <group key={mode} position={[(index - 1) * 0.33, 1.31, -0.6]} onClick={(event) => { event.stopPropagation(); if (!selected && canChooseSetup) void chooseMode(mode); }}>
            <mesh><planeGeometry args={[0.29, 0.065]} /><meshBasicMaterial color={selected ? "#80694b" : canChooseSetup ? "#302b27" : "#242326"} transparent opacity={0.94} /></mesh>
            <Text position={[0, 0, 0.006]} fontSize={0.033} color="#fff4df" anchorX="center" anchorY="middle">{mode === "open" ? "OPEN" : "ROLES"}</Text>
          </group>;
        })}
        {item.moveNumber === 0 && !item.turnActor && item.liftedColour === null && item.colours.length < 8 && <group position={[0.33, 1.31, -0.6]} onClick={(event) => { event.stopPropagation(); void addBowl(); }}>
          <mesh><planeGeometry args={[0.29, 0.065]} /><meshBasicMaterial color="#302b27" transparent opacity={0.94} /></mesh>
          <Text position={[0, 0, 0.006]} fontSize={0.03} color="#fff4df" anchorX="center" anchorY="middle">ADD BOWL</Text>
        </group>}
        <Text position={[0, 1.19, -0.6]} fontSize={0.046} color="#f1d8aa" anchorX="center" anchorY="middle">
          {item.mode === "open"
            ? (item.turnActor ? (sameActor(item.turnActor, actorId) ? "YOUR TURN · PLACE A STONE" : `TURN HELD · ${item.turnActor.slice(0, 16)}`) : "OPEN PLAY · PICK UP THE GLOWING STONE")
            : (seat < 0 ? "CHOOSE A COLOR ROLE · MOVE FREELY" : `YOUR COLOR · STONE ${seat + 1} · MOVE FREELY`)}
        </Text>
        {GO_STYLES.map((style, index) => {
          const x = (index - (GO_STYLES.length - 1) / 2) * 0.24;
          const selected = card?.style === style;
          return <group key={style} position={[x, 1.06, -0.6]} onClick={(event) => { event.stopPropagation(); void chooseStyle(style); }}>
            <mesh><planeGeometry args={[0.22, 0.075]} /><meshBasicMaterial color={selected ? "#9c774d" : "#302b27"} transparent opacity={0.92} /></mesh>
            <Text position={[0, 0, 0.006]} fontSize={0.033} color="#fff4df" anchorX="center" anchorY="middle">{style.toUpperCase()}</Text>
          </group>;
        })}
        {card && card.style !== "observer" && <group>
          {GO_RISKS.map((risk, index) => {
            const x = (index - 1) * 0.27;
            const selected = card.risk === risk;
            return <group key={risk} position={[x, 0.95, -0.6]} onClick={(event) => { event.stopPropagation(); void chooseRisk(risk); }}>
              <mesh><planeGeometry args={[0.25, 0.065]} /><meshBasicMaterial color={selected ? "#65533d" : "#24252a"} transparent opacity={0.9} /></mesh>
              <Text position={[0, 0, 0.006]} fontSize={0.03} color="#f1d8aa" anchorX="center" anchorY="middle">{risk.toUpperCase()}</Text>
            </group>;
          })}
          {canUseCard ? <group position={[0, 0.83, -0.6]} onClick={(event) => { event.stopPropagation(); void playStyleMove(); }}>
            <mesh><planeGeometry args={[0.7, 0.075]} /><meshBasicMaterial color="#476b58" transparent opacity={0.96} /></mesh>
            <Text position={[0, 0, 0.006]} fontSize={0.035} color="white" anchorX="center" anchorY="middle">PLAY MY STYLE MOVE · {item.moveNumber + 1}</Text>
          </group> : null}
        </group>}
        {canUseCard && !canReturnStone ? <Text position={[0, 0.74, -0.6]} fontSize={0.035} color="#f1d8aa" anchorX="center" anchorY="middle" onClick={(event) => { event.stopPropagation(); void pass(); }}>PASS</Text> : null}
        {canReturnStone && <Text position={[0, 0.74, -0.6]} fontSize={0.035} color="#f1d8aa" anchorX="center" anchorY="middle" onClick={(event) => { event.stopPropagation(); void returnStone(); }}>PUT BACK · KEEP TURN</Text>}
        {item.gameOver && <group position={[0, 0.83, -0.6]} onClick={(event) => { event.stopPropagation(); void restart(); }}>
          <mesh><planeGeometry args={[0.7, 0.075]} /><meshBasicMaterial color="#476b58" transparent opacity={0.96} /></mesh>
          <Text position={[0, 0, 0.006]} fontSize={0.035} color="white" anchorX="center" anchorY="middle">START A NEW GAME</Text>
        </group>}
        {seat >= 0 && <Text position={[0.55, 0.74, -0.6]} fontSize={0.032} color="#f1d8aa" anchorX="center" anchorY="middle" onClick={(event) => { event.stopPropagation(); void stand(); }}>LEAVE ROLE</Text>}
        {notice && <Text position={[0, 0.68, -0.6]} fontSize={0.035} color="#ffb39c" anchorX="center" anchorY="middle">{notice.slice(0, 90)}</Text>}
      </group>}
      <Text position={[0, 0.48, -0.91]} rotation={[0, 0, 0]} fontSize={0.09} color="#f1d8aa" anchorX="center" anchorY="middle">
        {`GO  ${item.size}×${item.size}${item.gameOver ? " · COMPLETE" : ` · MOVE ${item.moveNumber + 1}`}`}
      </Text>
      {item.score && <Text position={[0, 0.36, -0.91]} fontSize={0.045} color="#f1d8aa" anchorX="center" anchorY="middle">{scoreSummary(item)}</Text>}
    </group>
  );
}

export function RoomItems({ items, actorId = null }: { items: RoomItem[]; actorId?: string | null }) {
  return <>{items.map((item) => item.kind === "go" ? <GoTable key={item.id} item={item} actorId={actorId} /> : null)}</>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "That Go action could not be completed.";
}

function scoreSummary(item: GoRoomItem): string {
  if (!item.score) return "";
  const result = item.score.totals.map((total, index) => `S${index + 1} ${total}`).join(" · ");
  const winner = item.score.winner === null ? "TIE" : `STONE ${item.score.winner + 1} WINS`;
  return `${winner} · ${result}`;
}
