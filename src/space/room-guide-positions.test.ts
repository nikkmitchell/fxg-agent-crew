import { describe, expect, it } from "vitest";
import { ROOM_GUIDE } from "../../shared/room-guide";
import { BOWLS_AT } from "./SingingBowls";
import { GARDEN_AT } from "./GardenTray";
import { FIRE_AT } from "./EmberFire";
import { DOME_AT } from "./KaleidoscopeDome";
import { RIBBONS_AT } from "./LightRibbons";
import { POND_AT } from "./KoiPond";
import { MANDALA_AT } from "./SandMandala";
import { CHIMES_AT } from "./WindChimes";
import { WHEEL_AT } from "./PrayerWheel";
import { GONG_AT } from "./GongStand";
import { RAIN_AT } from "./RainCurtain";
import { LAUNCH_AT } from "./Lanterns";
import { INCENSE_AT } from "./IncenseBowl";
import { LIGHT_AT } from "./HoldTheLight";
import { VASE_AT } from "./IkebanaVase";
import { FIREFLIES_AT } from "./Fireflies";
import { MALA_AT } from "./MalaStand";
import { HARP_AT } from "./FloorHarp";
import { NEBULA_AT } from "./Nebula";
import { HOURGLASS_AT } from "./HourglassStand";
import { ORB_AT } from "./MeditationOrb";
import { TREE_AT } from "./StillnessTree";
import { READING_AT } from "./ReadingStone";
import { BOOK_AT } from "./RoomBook";
import { SHELF_AT } from "./CandleShelf";
import { TEA_AT } from "./TeaTable";
import { MINDFULNESS_PANEL_AT } from "./MindfulnessPanel";
import { LABYRINTH } from "../../shared/labyrinth";

/** [x, y, z] as the floor place the sign uses. */
const floor = ([x, , z]: readonly [number, number, number]) => ({ x, z });

/** The room guide sign copies each piece's place by hand; this keeps the copies honest. */
describe("the room guide says where things really are", () => {
  const places: Record<string, { x: number; z: number }> = {
    "Singing bowls": BOWLS_AT, "Sand garden": GARDEN_AT, "Ember fire": FIRE_AT, "Kaleidoscope dome": DOME_AT,
    "Light ribbons": RIBBONS_AT, "Koi pond": POND_AT, "Sand mandala": MANDALA_AT, "Wind chimes": CHIMES_AT,
    "Prayer wheel": WHEEL_AT, "Gong": GONG_AT, "Rain curtain": RAIN_AT, "Lanterns": LAUNCH_AT, "Incense": INCENSE_AT,
    "Hold the light": LIGHT_AT, "Ikebana": VASE_AT, "Fireflies": FIREFLIES_AT, "Mala": MALA_AT, "Floor harp": HARP_AT, "Nebula": NEBULA_AT, "Hourglass": HOURGLASS_AT,
    // Sill's and Inkstone's.
    "Breathing orb": floor(ORB_AT), "Stillness tree": floor(TREE_AT), "Reading stone": floor(READING_AT),
    "Room's book": floor(BOOK_AT), "Candle shelf": floor(SHELF_AT), "Tea table": floor(TEA_AT),
    "Practice panel": floor(MINDFULNESS_PANEL_AT), "Labyrinth": LABYRINTH,
  };
  for (const [name, at] of Object.entries(places)) {
    it(name, () => {
      const entry = ROOM_GUIDE.find((one) => one.name === name);
      expect(entry, `${name} is on the sign`).toBeDefined();
      expect(entry!.x).toBeCloseTo(at.x, 1);
      expect(entry!.z).toBeCloseTo(at.z, 1);
    });
  }
});
