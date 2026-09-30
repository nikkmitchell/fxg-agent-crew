import { describe, expect, it } from "vitest";
import { Body, Equator, Horizon, Observer } from "astronomy-engine";
import { easeSky, makeEarthSky, roomDirection, SKY_REFERENCE, skyProximity } from "./earth-sky";
import { readFileSync } from "node:fs";
import { decodeSkyCatalogue } from "./sky-catalogue";
const binary = readFileSync(new URL("../src/space/sky/hyg-bright.bin", import.meta.url));
const catalogue = { stars: decodeSkyCatalogue(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)) };

describe("an Earth sky in an XR room", () => {
  it("converts north/west/zenith into the room's north/east/up axes", () => {
    expect(roomDirection({ x: 1, y: 0, z: 0 })).toEqual([-0, 0, -1]);
    expect(roomDirection({ x: 0, y: -1, z: 0 })).toEqual([1, 0, -0]);
    expect(roomDirection({ x: 0, y: 0, z: 1 })).toEqual([-0, 1, -0]);
  });
  it("contains catalogue stars across both hemispheres, not generated positions", () => {
    expect(catalogue.stars.length).toBeGreaterThan(8000);
    expect(new Set(catalogue.stars.map((s) => s[0])).size).toBe(catalogue.stars.length);
    expect(catalogue.stars.every((s) => s[0] > 0 && s[3] <= 6.5 && s.length === 7)).toBe(true);
    expect(catalogue.stars.some((s) => s[2] > 85)).toBe(true);
    expect(catalogue.stars.some((s) => s[2] < -85)).toBe(true);
  });
  it("places Polaris near the north celestial pole at the observer's latitude", () => {
    const polaris = [1, 2.530301, 89.264109, 1.97, .6, 0, 0];
    const sky = makeEarthSky([polaris], { ...SKY_REFERENCE, latitude: 52 });
    const [east, altitude, south] = sky.stars[0].direction;
    expect(Math.asin(altitude) * 180 / Math.PI).toBeCloseTo(52, 0);
    expect(Math.abs(east)).toBeLessThan(.02);
    expect(south).toBeLessThan(0);
  });
  it("agrees with a separate altitude/azimuth calculation for the moon", () => {
    const observer = new Observer(SKY_REFERENCE.latitude, SKY_REFERENCE.longitude, 0);
    const moon = Equator(Body.Moon, new Date(SKY_REFERENCE.at), observer, true, true);
    const horizon = Horizon(new Date(SKY_REFERENCE.at), observer, moon.ra, moon.dec);
    const direction = makeEarthSky([], SKY_REFERENCE).moon;
    expect(Math.asin(direction[1]) * 180 / Math.PI).toBeCloseTo(horizon.altitude, 5);
    const azimuth = (Math.atan2(direction[0], -direction[2]) * 180 / Math.PI + 360) % 360;
    expect(azimuth).toBeCloseTo(horizon.azimuth, 5);
  });
  it("changes the lunar direction and illuminated fraction over a week", () => {
    const a = makeEarthSky([], SKY_REFERENCE);
    const b = makeEarthSky([], { ...SKY_REFERENCE, at: "2026-10-03T14:00:00Z" });
    const lit = (sky: typeof a) => (1 - sky.moon.reduce((sum, v, i) => sum + v * sky.sun[i], 0)) / 2;
    expect(lit(a)).toBeGreaterThan(.95);
    expect(Math.abs(lit(a) - lit(b))).toBeGreaterThan(.3);
    expect(a.moon).not.toEqual(b.moon);
  });
  it("places the five naked-eye planets independently of stars and the Moon", () => {
    const sky = makeEarthSky([], SKY_REFERENCE);
    expect(sky.planets.map((planet) => planet.name)).toEqual(["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]);
    for (const planet of sky.planets) {
      expect(Math.hypot(...planet.direction)).toBeCloseTo(1, 10);
      expect(Number.isFinite(planet.magnitude)).toBe(true);
      expect(planet.direction).not.toEqual(sky.moon);
    }
  });
  it("is fully revealed only inside the clearing and absent outside the approach", () => {
    expect(skyProximity(1.8)).toBe(1);
    expect(skyProximity(1.81)).toBeLessThan(1);
    expect(skyProximity(3.4)).toBeCloseTo(.5);
    expect(skyProximity(5)).toBe(0);
    expect(skyProximity(8)).toBe(0);
  });
  it("fades at the same pace on 72 and 120 Hz headsets", () => {
    const fade = (fps: number) => { let level = 0; for (let i = 0; i < fps; i++) level = easeSky(level, 1, 1 / fps); return level; };
    expect(fade(72)).toBeCloseTo(fade(120), 10);
    expect(easeSky(.5, 0, .05)).toBeLessThan(.5);
  });
});
