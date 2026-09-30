import { expect, test } from "vitest";
import { SKY_REFERENCE } from "./earth-sky";
import { SKY_NIGHTS, skyChoiceFromQuery, validateSkyChoice } from "./sky-nights";

test("shared custom nights preserve early years and explicit UTC across timezones", () => {
  const choice = skyChoiceFromQuery(new URLSearchParams({ at: "0033-04-01T20:00:00Z", lat: "31.7683", lon: "35.2137", place: "Jerusalem" }));
  expect(choice.reference.at).toBe("0033-04-01T20:00:00.000Z");
  expect(choice.reference.latitude).toBe(31.7683);
  expect(choice.live).toBe(false);
  expect(skyChoiceFromQuery(new URLSearchParams("night=reference")).live).toBe(false);
  expect(skyChoiceFromQuery(new URLSearchParams()).live).toBe(true);
});

test("invalid dates, absent coordinates and deep-time requests cannot silently select another sky", () => {
  for (const at of ["2026-02-30T20:00:00Z", "0000-01-01T00:00:00Z", "3001-01-01T00:00:00Z", "2026-09-26T22:00:00", "-065000000-01-01T00:00:00Z"]) {
    expect(() => validateSkyChoice({ ...SKY_REFERENCE, at })).toThrow();
  }
  for (const lat of ["", " ", "91", "NaN"]) expect(() => skyChoiceFromQuery(new URLSearchParams({ at: SKY_REFERENCE.at, lat, lon: "0" }))).toThrow();
  expect(() => validateSkyChoice({ ...SKY_REFERENCE, longitude: 181 })).toThrow();
});

test("historical preset links select the same sourced night after a reload", () => {
  for (const night of SKY_NIGHTS) {
    const choice = skyChoiceFromQuery(new URLSearchParams({ preset: night.id }));
    expect(validateSkyChoice(choice.reference).at).toBe(new Date(night.reference.at).toISOString());
    expect(choice.reference.latitude).toBe(night.reference.latitude);
    expect(choice.live).toBe(false);
    if (night.id !== "hangzhou") expect(night.sources.length).toBeGreaterThan(0);
  }
});
