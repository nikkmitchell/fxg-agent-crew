/**
 * THE HEADSET SETTINGS, IN A BROWSER — a development page, never shipped.
 *
 * The menu only exists inside a headset session, and the emulator's view is
 * black (see xr-store.ts), so until now nothing about how it LOOKS had been
 * seen by anyone but Nikk through the lenses. This draws the very same
 * SettingsMenu3D, from the very same settingsSections, at the same distance
 * the room puts it (1.95 m, at eye height), with made-up people and rooms.
 *
 *   pnpm dev, then open /dev/menu-preview.html
 *
 * vite serves it in development only: the build's one entry is index.html.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { SettingsMenu3D } from "./SettingsMenu3D";
import { LobbyWelcome } from "./LobbyWelcome";
import { SingingBowls, BOWLS_AT } from "./SingingBowls";
import { GardenTray, GARDEN_AT } from "./GardenTray";
import { EmberFire, FIRE_AT } from "./EmberFire";
import { KaleidoscopeDome, DOME_AT } from "./KaleidoscopeDome";
import { LightRibbons, RIBBONS_AT } from "./LightRibbons";
import { KoiPond, POND_AT } from "./KoiPond";
import { PaperBoats } from "./PaperBoats";
import { SandMandala, MANDALA_AT } from "./SandMandala";
import { PrayerWheel, WHEEL_AT } from "./PrayerWheel";
import { GongStand } from "./GongStand";
import { RainCurtain, RAIN_AT } from "./RainCurtain";
import { IncenseBowl, INCENSE_AT } from "./IncenseBowl";
import { IkebanaVase, VASE_AT } from "./IkebanaVase";
import { Fireflies, FIREFLIES_AT } from "./Fireflies";
import { MalaStand } from "./MalaStand";
import { Moon } from "./Moon";
import { Shore, SHORE_AT } from "./Shore";
import { TidePool, TIDEPOOL_AT } from "./TidePool";
import { Conch, CONCH_AT } from "./Conch";
import { ShoreBench, BENCH_AT } from "./ShoreBench";
import { GlowSteps } from "./GlowSteps";
import type { WirePerson } from "../../shared/space-wire";

/** A pretend person pacing across the shore, for ?steps=1. */
const walker = { current: [] as WirePerson[] };
setInterval(() => {
  const t = Date.now() / 1000;
  walker.current = [{ actorId: "walker", at: { x: SHORE_AT.x + Math.sin(t * 0.4) * 0.6, z: SHORE_AT.z + Math.cos(t * 0.9) * 0.25 } } as WirePerson];
}, 50);
import { Nebula, NEBULA_AT } from "./Nebula";
import { HourglassStand, HOURGLASS_AT } from "./HourglassStand";
import { SETTINGS_TABS, settingsBadge, settingsSections, tabOfView, type ArrangeMode, type SettingsView } from "./settings-menu-model";
import { roomMenuRows } from "../../shared/room-switch";

function Preview() {
  const params = new URLSearchParams(window.location.search);
  const [view, setView] = useState<SettingsView>((params.get("view") as SettingsView) ?? "root");
  const [voiceOn, setVoiceOn] = useState(true);
  const [muted, setMuted] = useState<Set<string>>(new Set(["baiwei2"]));
  const [hear, setHear] = useState(true);
  const [hands, setHands] = useState(true);
  const [teleport, setTeleport] = useState(false);
  const [dark, setDark] = useState(true);
  const [rings, setRings] = useState(true);
  const [still, setStill] = useState(false);
  const [pointer, setPointer] = useState(60);
  const [pass, setPass] = useState(true);
  const [orb, setOrb] = useState(false);
  const [panels, setPanels] = useState([
    { id: "board", label: "Work board", shown: true, mode: "locked" as ArrangeMode },
    { id: "mood", label: "Mood board", shown: true, mode: "move" as ArrangeMode },
    { id: "chat", label: "Chat", shown: false, mode: "locked" as ArrangeMode },
    { id: "people", label: "Who is here", shown: true, mode: "locked" as ArrangeMode },
    { id: "said", label: "What has been said", shown: false, mode: "locked" as ArrangeMode },
  ]);
  const [hiddenAll, setHiddenAll] = useState(false);
  const [hiddenMe, setHiddenMe] = useState(false);
  const [project, setProject] = useState<string | null>("saha-ing");
  const [board, setBoard] = useState<string | null>(null);
  const lobby = params.get("lobby") === "1";
  const update = params.get("update") !== "0";
  const log = (what: string) => console.log(`[menu-preview] ${what}`);

  const mine = [
    { roomName: "saha.ing", visibility: "public", ownerName: null },
    { roomName: "meditation.AR", visibility: "private", ownerName: "Nikk2" },
    { roomName: "lobby", visibility: "public", ownerName: null },
  ] as never[];
  const open = [{ roomName: "go-club", visibility: "public", ownerName: "baiwei2" }] as never[];

  const sections = settingsSections({
    view,
    goTo: setView,
    voice: {
      on: voiceOn,
      starting: false,
      others: ["baiwei2", "Nikk2"],
      isMuted: (name) => muted.has(name),
      setOn: setVoiceOn,
      setMuted: (name, on) => setMuted((before) => {
        const next = new Set(before);
        if (on) next.add(name);
        else next.delete(name);
        return next;
      }),
    },
    voiceExtra: [],
    hearReplies: hear,
    setHearReplies: setHear,
    handsShown: hands,
    setHandsShown: setHands,
    teleport,
    setTeleport,
    resetHead: () => log("reset head"),
    view3d: {
      dark, setDark, rings, setRings,
      hideStill: still, hiddenStill: 2, setHideStill: setStill,
      pointer: `${pointer}%`, pointerOn: pointer > 0,
      pointerToggle: () => setPointer((p) => (p > 0 ? 0 : 60)),
      pointerLess: () => setPointer((p) => Math.max(0, p - 10)),
      pointerMore: () => setPointer((p) => Math.min(100, p + 10)),
      passthroughAvailable: true, passthrough: pass, blendMode: "alpha-blend",
      togglePassthrough: () => setPass((p) => !p),
    },
    recorder: lobby
      ? {
          status: "idle", showPersonalUi: true, hasTake: true, playing: false, notice: null,
          start: () => log("record"), stop: () => log("stop"), setShowPersonalUi: () => {},
          play: () => log("play"), stopPlayback: () => {}, discard: () => log("discard"),
        }
      : null,
    roomRows: roomMenuRows(mine, open, "saha.ing", { project: "Saha", people: ["baiwei2", "Nikk2", "Sill"] }),
    switching: null,
    goRoom: (room, join) => log(`${join ? "join" : "go"} ${room}`),
    toLobby: () => log("lobby"),
    goTables: [{ size: 9, players: 2 }],
    orbHere: orb,
    addGoTable: () => log("add go"),
    setOrb,
    showing: { projectId: project, projectName: project ? "Saha" : null, boardId: board, boardName: board ? "Lobby ideas" : null, setBy: "Nikk2", refusal: null },
    projects: [{ id: "saha-ing", name: "Saha" }, { id: "fxg", name: "FXG Crew" }],
    boards: [{ id: "lobby", title: "Lobby ideas" }, { id: "avatars", title: "Avatars" }],
    choose: (p, b) => {
      setProject(p);
      setBoard(b);
    },
    panels,
    setPanelShown: (id, shown) => setPanels((all) => all.map((p) => (p.id === id ? { ...p, shown } : p))),
    cyclePanel: (id) => setPanels((all) => all.map((p) => (p.id === id ? { ...p, mode: p.mode === "locked" ? "move" : p.mode === "move" ? "resize" : "locked" } : p))),
    anyUnlocked: panels.some((p) => p.shown && p.mode !== "locked"),
    lockAll: () => setPanels((all) => all.map((p) => ({ ...p, mode: "locked" }))),
    panelRefusal: null,
    agents: ["Nightjar", "Sill", "Lumenfold", "Skein", "Inkstone"],
    agentsHiddenForEveryone: hiddenAll,
    setAgentsHiddenForEveryone: setHiddenAll,
    agentsHiddenForMe: hiddenMe,
    setAgentsHiddenForMe: setHiddenMe,
    placeAgent: (agent, where) => log(`${agent} ${where}`),
  });

  return (
    <Canvas
      // ?fov=40 to look closely; 90 is about what a headset sees.
      camera={{ position: params.get("moon") === "1" ? [0, 1.6, 6.2] : [0, 1.6, 0], fov: Number(params.get("fov") ?? 90), near: 0.05, far: 50 }}
      onCreated={({ camera }) => (params.get("bench") === "1" ? camera.lookAt(0, 1.1, -1.3) : params.get("conch") === "1" ? camera.lookAt(0, 1.5, -1.0) : params.get("pool") === "1" ? camera.lookAt(0, 0.8, -1.3) : params.get("shore") === "1" ? camera.lookAt(0, 0.6, -1.3) : params.get("hourglass") === "1" ? camera.lookAt(0, 1.6, -0.5) : params.get("nebula") === "1" ? camera.lookAt(0, 1.6, -2.0) : params.get("moon") === "1" ? camera.lookAt(0, 8, -10) : params.get("mala") === "1" ? camera.lookAt(-1.6, 1.3, -5.9) : params.get("fireflies") === "1" ? camera.lookAt(0, 1.4, -2.2) : params.get("vase") === "1" ? camera.lookAt(0, 1.4, -1.0) : params.get("incense") === "1" ? camera.lookAt(0, 1.5, -0.9) : params.get("rain") === "1" ? camera.lookAt(0, 1.2, -2.2) : params.get("gong") === "1" ? camera.lookAt(3.7, 1.2, 0.6) : params.get("wheel") === "1" ? camera.lookAt(0, 1.2, -1.3) : params.get("mandala") === "1" ? camera.lookAt(0, 1.0, -1.0) : params.get("pond") === "1" ? camera.lookAt(0, 0.9, -1.1) : params.get("ribbons") === "1" ? camera.lookAt(0, 1.1, -1.6) : params.get("fire") === "1" ? camera.lookAt(FIRE_AT.x * 0.8, 0.8, FIRE_AT.z - 6.2) : params.get("bowls") === "1" || params.get("garden") === "1" ? camera.lookAt(0, 0.7, -1.05) : camera.lookAt(0, 1.6, -1))}
      style={{ position: "fixed", inset: 0, background: "linear-gradient(#5c6470, #3b3f46 55%, #2a2c30)" }}
    >
      {params.get("moon") === "1" ? <Moon /> : null}
      {params.get("bench") === "1" ? (
        <group position={[-BENCH_AT.x, 0.6, -BENCH_AT.z - 1.3]}>
          <ambientLight intensity={0.8} />
          <ShoreBench />
        </group>
      ) : null}
      {params.get("conch") === "1" ? (
        <group position={[-CONCH_AT.x, 0.3, -CONCH_AT.z - 1.0]}>
          <ambientLight intensity={0.8} />
          <Conch />
        </group>
      ) : null}
      {params.get("pool") === "1" ? (
        <group position={[-TIDEPOOL_AT.x, 0.6, -TIDEPOOL_AT.z - 1.3]}>
          <ambientLight intensity={0.8} />
          <TidePool />
        </group>
      ) : null}
      {params.get("shore") === "1" ? (
        <group position={[-SHORE_AT.x, 0.6, -SHORE_AT.z - 1.3]}>
          {params.get("steps") === "1" ? <GlowSteps peopleRef={walker} you={null} /> : null}
          <Shore />
        </group>
      ) : null}
      {params.get("hourglass") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <group position={[-HOURGLASS_AT.x, 0.9, -HOURGLASS_AT.z - 0.5]}>
            <HourglassStand />
          </group>
        </>
      ) : null}
      {params.get("nebula") === "1" ? (
        <group position={[-NEBULA_AT.x, 0.3, -NEBULA_AT.z - 2.0]}>
          <Nebula peopleRef={{ current: [] }} you="preview" />
        </group>
      ) : null}
      {params.get("mala") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <group position={[0, 0.4, -6.2]}>
            <MalaStand />
          </group>
        </>
      ) : null}
      {params.get("fireflies") === "1" ? (
        <group position={[-FIREFLIES_AT.x, 0.4, -FIREFLIES_AT.z - 2.2]}>
          <Fireflies peopleRef={{ current: [] }} you="preview" />
        </group>
      ) : null}
      {params.get("vase") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-VASE_AT.x, 0.6, -VASE_AT.z - 1.0]}>
            <IkebanaVase />
          </group>
        </>
      ) : null}
      {params.get("incense") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <group position={[-INCENSE_AT.x, 0.6, -INCENSE_AT.z - 0.9]}>
            <IncenseBowl />
          </group>
        </>
      ) : null}
      {params.get("rain") === "1" ? (
        <group position={[-RAIN_AT.x, 0, -RAIN_AT.z - 2.2]}>
          <RainCurtain />
        </group>
      ) : null}
      {params.get("gong") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[0, 0, -6.2]}>
            <GongStand you="preview" />
          </group>
        </>
      ) : null}
      {params.get("wheel") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-WHEEL_AT.x, 0.2, -WHEEL_AT.z - 1.3]}>
            <PrayerWheel you="preview" />
          </group>
        </>
      ) : null}
      {params.get("mandala") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-MANDALA_AT.x, 0.4, -MANDALA_AT.z - 1.0]}>
            <SandMandala />
          </group>
        </>
      ) : null}
      {params.get("pond") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-POND_AT.x, 0.6, -POND_AT.z - 1.1]}>
            <KoiPond peopleRef={{ current: [] }} />
            <PaperBoats />
          </group>
        </>
      ) : null}
      {params.get("ribbons") === "1" ? (
        // Drive a hand from the console: selfPose.hands.right = { p, q }.
        <group position={[-RIBBONS_AT.x, 0, -RIBBONS_AT.z - 1.6]}>
          <LightRibbons peopleRef={{ current: [] }} you="preview" />
        </group>
      ) : null}
      {params.get("dome") ? (
        // ?dome=out stands 3 m away; ?dome=in stands inside it.
        <group position={[-DOME_AT.x, 0.4, -DOME_AT.z + (params.get("dome") === "in" ? 0 : -4)]}>
          <KaleidoscopeDome meditation={null} you="preview" peopleRef={{ current: params.get("together") === "1" ? ([{ actorId: "someone", at: { x: 0.3, y: 0, z: 0.2 } }] as never[]) : [] }} />
        </group>
      ) : null}
      {params.get("fire") === "1" ? (
        <>
          <hemisphereLight args={["#8090b0", "#101218", 0.6]} />
          <group position={[0, 0, -6.2]}>
            <EmberFire you="preview" />
          </group>
        </>
      ) : null}
      {params.get("garden") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-GARDEN_AT.x, 0, -GARDEN_AT.z - 1.0]}>
            <GardenTray />
          </group>
        </>
      ) : null}
      {params.get("bowls") === "1" ? (
        <>
          <hemisphereLight args={["#ffffff", "#2a3040", 2.2]} />
          <directionalLight position={[3, 6, 4]} intensity={1.4} />
          <group position={[-BOWLS_AT.x, 0, -BOWLS_AT.z - 1.1]}>
            <SingingBowls you="preview" />
          </group>
        </>
      ) : null}
      {params.get("welcome") === "1" ? (
        <group position={[0, 0, -2.4]}>
          <LobbyWelcome />
        </group>
      ) : null}
      {params.get("welcome") === "1" || params.get("bowls") === "1" || params.get("garden") === "1" || params.get("fire") === "1" || params.get("dome") || params.get("ribbons") || params.get("pond") || params.get("mandala") || params.get("wheel") || params.get("gong") || params.get("rain") || params.get("incense") || params.get("vase") || params.get("fireflies") || params.get("mala") || params.get("moon") || params.get("nebula") || params.get("hourglass") || params.get("shore") || params.get("pool") || params.get("conch") || params.get("bench") ? null : <SettingsMenu3D
        position={[0, 1.6, -1.95]}
        model={{
          title: "Settings",
          tabs: SETTINGS_TABS,
          active: tabOfView(view),
          onTab: (id) => setView(SETTINGS_TABS.find((tab) => tab.id === id)?.view ?? "root"),
          onClose: () => log("close"),
          sections,
          badge: settingsBadge(update, () => log("update")),
        }}
      />}
    </Canvas>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
