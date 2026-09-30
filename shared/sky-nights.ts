import { SKY_REFERENCE, type SkyReference } from "./earth-sky.js";

export type SkyNight = { id: string; title: string; reference: SkyReference; note: string; sources: { title: string; url: string }[] };
/** Dates use the proleptic Gregorian calendar and explicit UTC, never browser local time. */
export const SKY_NIGHTS: SkyNight[] = [
  { id: "hangzhou", title: "Hangzhou reference night", reference: SKY_REFERENCE,
    note: "Our shared reference: 26 September 2026, 22:00 in Hangzhou.", sources: [] },
  { id: "galileo", title: "Galileo's first Jupiter-moon night · 1610", reference: {
    latitude: 45.4064, longitude: 11.8768, at: "1610-01-07T17:00:00Z", label: "Padua · 7 January 1610 · early evening" },
    note: "Galileo recorded his first observation on 7 January, in the first hour of night. 17:00 UTC is an illustrative early-evening choice, not a recorded clock time. Jupiter's moons are not drawn at this naked-eye scale.",
    sources: [ { title: "NASA JPL: Galileo's account", url: "https://www.jpl.nasa.gov/blog/2010/1/400th-anniversary-of-galileos-discovery" },
      { title: "NASA JPL: the observation in Padua", url: "https://www.jpl.nasa.gov/videos/whats-up-february-2010-galileos-first-telescopic-view-of-jupiter/" } ] },
  { id: "herschel", title: "Herschel's discovery night · 1781", reference: {
    latitude: 51.3811, longitude: -2.3683, at: "1781-03-13T22:40:00Z", label: "Bath · 13 March 1781 · discovery evening" },
    note: "The museum places Herschel's observation between 22:00 and 23:00 local time. This chooses about 22:30 local mean solar time; the exact minute is not known. Uranus needs a telescope and is not added to the five naked-eye planets.",
    sources: [ { title: "Herschel Museum: the garden and telescope", url: "https://herschelmuseum.org.uk/about/explore/" } ] },
  { id: "beethoven", title: "After Beethoven's Ninth premiere · 1824", reference: {
    latitude: 48.2082, longitude: 16.3738, at: "1824-05-07T21:00:00Z", label: "Vienna · 7 May 1824 · imagined late evening" },
    note: "The premiere date and Vienna location are documented. 21:00 UTC (about 22:05 local mean solar time) is an imagined late-evening viewpoint, not a recorded concert ending or evidence Beethoven saw this sky.",
    sources: [ { title: "Beethoven-Haus: the premiere", url: "https://www.beethoven.de/en/g/bthvn2024" } ] },
  { id: "apollo", title: "Apollo 11 first-step broadcast · 1969", reference: {
    latitude: 29.7604, longitude: -95.3698, at: "1969-07-21T02:56:15Z", label: "Houston · Apollo 11 first-step broadcast · 21 July 1969 UTC" },
    note: "NASA's mission-report time for Armstrong's first contact is 02:56:15 UTC. This shows the sky from Houston during the broadcast, not the view from the lunar surface. Houston's observer location is approximate.",
    sources: [ { title: "NASA: One Small Step, mission-report timing", url: "https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11.step.html" } ] },
];

export const SKY_PLACES = [
  { label: "Hangzhou", latitude: 30.2741, longitude: 120.1551 },
  { label: "Padua", latitude: 45.4064, longitude: 11.8768 },
  { label: "Bath", latitude: 51.3811, longitude: -2.3683 },
  { label: "Vienna", latitude: 48.2082, longitude: 16.3738 },
  { label: "Houston", latitude: 29.7604, longitude: -95.3698 },
  { label: "Jerusalem", latitude: 31.7683, longitude: 35.2137 },
  { label: "Kyoto", latitude: 35.0116, longitude: 135.7681 },
  { label: "Reykjavik", latitude: 64.1466, longitude: -21.9426 },
];

/** A deliberate product bound, not a claim of uniform accuracy throughout it. */
export function validateSkyChoice(reference: SkyReference): SkyReference {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(reference.at)) throw new Error("Use an explicit UTC date and time.");
  const ms = Date.parse(reference.at);
  const year = new Date(ms).getUTCFullYear();
  if (!Number.isFinite(ms) || year < 1 || year > 3000) throw new Error("Choose a year from 0001 to 3000. Deep-time skies need a different reconstruction.");
  if (new Date(ms).toISOString().slice(0, 19) !== reference.at.slice(0, 19)) throw new Error("Choose a valid calendar date and time.");
  if (!Number.isFinite(reference.latitude) || Math.abs(reference.latitude) > 90 ||
      !Number.isFinite(reference.longitude) || Math.abs(reference.longitude) > 180) throw new Error("Latitude must be -90 to 90; longitude -180 to 180.");
  return { ...reference, at: new Date(ms).toISOString(), label: reference.label.trim().slice(0, 80) || "Custom place" };
}

export function skyChoiceFromQuery(query: URLSearchParams): { reference: SkyReference; live: boolean } {
  const preset = SKY_NIGHTS.find(night => night.id === query.get("preset"));
  if (preset) return { reference: preset.reference, live: false };
  if (query.has("at") || query.has("lat") || query.has("lon")) {
    if (!query.has("at") || !query.get("lat")?.trim() || !query.get("lon")?.trim()) throw new Error("A shared sky needs a UTC date, latitude and longitude.");
    const reference = validateSkyChoice({ at: query.get("at")!, latitude: Number(query.get("lat")),
      longitude: Number(query.get("lon")), label: query.get("place") || "Custom place" });
    return { reference, live: query.get("mode") === "live" };
  }
  return { reference: SKY_REFERENCE, live: query.get("night") !== "reference" };
}
