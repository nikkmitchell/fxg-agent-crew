import { AstroTime, Body, Equator, Illumination, Observer, RotateVector, Rotation_EQJ_HOR, Vector } from "astronomy-engine";

export type SkyReference = { latitude: number; longitude: number; at: string; label: string };
/** A deliberate, frozen night, not the visitor's inferred location or clock. */
export const SKY_REFERENCE: SkyReference = {
  latitude: 30.2741, longitude: 120.1551, at: "2026-09-26T14:00:00Z",
  label: "Hangzhou · 26 September 2026 · 22:00 CST",
};
export type Direction = [number, number, number];
export type CatalogueStar = number[];
export type SkyStar = { id: number; direction: Direction; magnitude: number; colorIndex: number };
export type SkyPlanet = { name: string; direction: Direction; magnitude: number; color: string };
export type EarthSkySnapshot = { stars: SkyStar[]; planets: SkyPlanet[]; moon: Direction; sun: Direction; reference: SkyReference };

/** Astronomy Engine HOR is north/west/up; the room is east/up/south. */
export function roomDirection(v: { x: number; y: number; z: number }): Direction {
  const length = Math.hypot(v.x, v.y, v.z);
  if (length === 0 || !Number.isFinite(length)) throw new Error("Invalid sky direction");
  return [-v.y / length, v.z / length, -v.x / length];
}

export function makeEarthSky(rows: CatalogueStar[], reference: SkyReference): EarthSkySnapshot {
  if (!Number.isFinite(reference.latitude) || Math.abs(reference.latitude) > 90 ||
      !Number.isFinite(reference.longitude) || Math.abs(reference.longitude) > 180 ||
      !Number.isFinite(Date.parse(reference.at))) throw new Error("Invalid sky reference");
  const time = new AstroTime(new Date(reference.at));
  const observer = new Observer(reference.latitude, reference.longitude, 0);
  const rotation = Rotation_EQJ_HOR(time, observer);
  const years = (Date.parse(reference.at) - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
  const stars = rows.map(([id, raHours, decDegrees, magnitude, colorIndex, pmRa, pmDec]) => {
    const ra = raHours * Math.PI / 12 + pmRa * years;
    const dec = decDegrees * Math.PI / 180 + pmDec * years;
    const vector = new Vector(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), time);
    return { id, direction: roomDirection(RotateVector(rotation, vector)), magnitude, colorIndex };
  });
  // Topocentric J2000 coordinates use the SAME rotation as the catalogue.
  // No assumption that the moon always rises in the evening.
  const body = (which: Body) => roomDirection(RotateVector(rotation, Equator(which, time, observer, false, true).vec));
  const planets = ([
    [Body.Mercury, "#e2dfd6"], [Body.Venus, "#fff5db"], [Body.Mars, "#ffc1a0"],
    [Body.Jupiter, "#f4e3cc"], [Body.Saturn, "#eadcba"],
  ] as const).map(([which, color]) => ({ name: which, color, direction: body(which), magnitude: Illumination(which, time).mag }));
  return { stars, planets, moon: body(Body.Moon), sun: body(Body.Sun), reference };
}

/** Local floor distance, full within inner, absent beyond outer, continuous in between. */
export function skyProximity(distance: number, inner = 1.8, outer = 5): number {
  if (!(inner >= 0 && outer > inner)) throw new Error("Invalid sky fade radii");
  const t = Math.max(0, Math.min(1, (distance - inner) / (outer - inner)));
  return 1 - t * t * (3 - 2 * t);
}

/** Seconds-based easing: identical fade duration at 72, 90, or 120 Hz. */
export function easeSky(current: number, target: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, Math.min(delta, 0.1)) / 0.75));
}
