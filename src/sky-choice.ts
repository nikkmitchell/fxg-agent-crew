import { SKY_NIGHTS, SKY_PLACES, validateSkyChoice } from "../shared/sky-nights";
import type { SkyReference } from "../shared/earth-sky";
import type { EarthSkyClock } from "./space/earth-sky-clock";

/** Optional preview controls: no geolocation, storage, requests or shared-state writes. */
export function installSkyChoice(clock: EarthSkyClock, initial: { reference: SkyReference; live: boolean }, note: HTMLElement, initialError = ""): void {
  const input = (id: string) => document.querySelector<HTMLInputElement>(id)!;
  const preset = document.querySelector<HTMLSelectElement>("#sky-preset")!;
  const place = document.querySelector<HTMLSelectElement>("#sky-place")!;
  const form = document.querySelector<HTMLFormElement>("#sky-choice")!;
  const story = document.querySelector<HTMLElement>("#night-story")!;
  const sources = document.querySelector<HTMLElement>("#night-sources")!;
  const error = document.querySelector<HTMLElement>("#choice-error")!;
  const fields = { at: input("#sky-at"), lat: input("#sky-lat"), lon: input("#sky-lon"), name: input("#place-name") };
  preset.add(new Option("Custom / current selection", "custom"));
  SKY_NIGHTS.forEach(night => preset.add(new Option(night.title, night.id)));
  place.add(new Option("Custom coordinates", "custom"));
  SKY_PLACES.forEach((city, i) => place.add(new Option(city.label, String(i))));
  let reference = initial.reference;
  const explain = (id: string) => {
    const night = SKY_NIGHTS.find(item => item.id === id);
    story.textContent = night?.note ?? "Your own selected date and place. The clock advances at real speed.";
    sources.replaceChildren();
    night?.sources.forEach((source, i) => {
      if (i) sources.append(" · ");
      const link = document.createElement("a"); link.href = source.url; link.textContent = source.title;
      link.target = "_blank"; link.rel = "noopener noreferrer"; sources.append(link);
    });
  };
  const populate = (ref: SkyReference, live: boolean, id = "custom") => {
    reference = ref;
    fields.at.value = new Date(live ? Date.now() : ref.at).toISOString().slice(0, 19);
    fields.lat.value = String(ref.latitude); fields.lon.value = String(ref.longitude); fields.name.value = ref.label;
    const city = SKY_PLACES.findIndex(item => item.latitude === ref.latitude && item.longitude === ref.longitude);
    place.value = city < 0 ? "custom" : String(city); preset.value = id; explain(id);
    note.textContent = `${live && city >= 0 ? SKY_PLACES[city].label : ref.label} · ${live ? "actual UTC time" : ref.at + " · advancing at real speed"}. Full 360 sphere; north is along the path.`;
  };
  const share = (ref: SkyReference, live: boolean, id: string) => {
    const url = new URL(location.href);
    for (const key of ["night", "preset", "at", "lat", "lon", "place", "mode"]) url.searchParams.delete(key);
    if (id !== "custom") url.searchParams.set("preset", id);
    else {
      url.searchParams.set("at", ref.at); url.searchParams.set("lat", String(ref.latitude));
      url.searchParams.set("lon", String(ref.longitude)); url.searchParams.set("place", ref.label);
      if (live) url.searchParams.set("mode", "live");
    }
    history.replaceState(null, "", url);
  };
  const apply = (ref: SkyReference, live = false, id = "custom") => {
    try {
      const chosen = validateSkyChoice(ref);
      clock.select(chosen, live); populate(chosen, live, id); share(chosen, live, id);
      error.textContent = "";
    } catch (problem) { error.textContent = problem instanceof Error ? problem.message : "Could not select this sky."; }
  };
  const custom = () => validateSkyChoice({ latitude: Number(fields.lat.value), longitude: Number(fields.lon.value),
    at: fields.at.value + (fields.at.value.length === 16 ? ":00Z" : "Z"), label: fields.name.value });
  preset.addEventListener("change", () => {
    const night = SKY_NIGHTS.find(item => item.id === preset.value);
    if (night) apply(night.reference, false, night.id); else explain("custom");
  });
  place.addEventListener("change", () => {
    const city = SKY_PLACES[Number(place.value)];
    if (city) { fields.lat.value = String(city.latitude); fields.lon.value = String(city.longitude); fields.name.value = city.label; }
    preset.value = "custom"; explain("custom");
  });
  for (const field of Object.values(fields)) field.addEventListener("input", () => {
    preset.value = "custom"; explain("custom");
    if (field === fields.lat || field === fields.lon) place.value = "custom";
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    try { apply(custom(), false, preset.value); } catch (problem) { error.textContent = (problem as Error).message; }
  });
  document.querySelector("#sky-now")!.addEventListener("click", () => {
    fields.at.value = new Date().toISOString().slice(0, 19);
    if (!form.reportValidity()) return;
    try { apply(custom(), true); } catch (problem) { error.textContent = (problem as Error).message; }
  });
  // Editing a name or date must never walk/turn the visitor.
  for (const event of ["keydown", "keyup", "pointerdown", "wheel"]) form.addEventListener(event, e => e.stopPropagation());
  const initialPreset = SKY_NIGHTS.find(item => item.reference.at === reference.at && item.reference.latitude === reference.latitude && item.reference.longitude === reference.longitude);
  populate(reference, initial.live, initial.live ? "custom" : initialPreset?.id);
  error.textContent = initialError;
}
