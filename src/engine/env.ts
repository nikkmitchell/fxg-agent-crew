import * as THREE from "three";
import type { EnvSettings } from "./types";

/**
 * THE SURROUNDINGS, IN LAYERS (docs/things/DESIGN.md, environments). Each
 * thing that fills the surroundings holds one layer; the room shows its own
 * values under all of them, with the newest layer on top. Taking a layer
 * away shows what is left, never a snapshot from when that layer came: so a
 * push (the new version's layer arrives, then the old one's leaves) keeps the
 * new sky, and removing the last one gives the room its own back.
 *
 * When the last layer goes, a value the room changed meanwhile is left as the
 * room set it: the room's own background and far plane follow what it shows,
 * and are not put back over it.
 */
export type EnvState = {
  background: THREE.Color | THREE.Texture | null;
  fog: THREE.Fog | THREE.FogExp2 | null;
  far: number;
  exposure: number;
};

export interface EnvIo {
  read(): EnvState;
  write(state: EnvState): void;
}

export interface EnvLayer {
  /** These settings, over what this layer said before. */
  set(settings: Partial<EnvSettings>): void;
  remove(): void;
}

const KEYS = ["background", "fog", "far", "exposure"] as const;

export class EnvStack {
  private readonly layers: Array<{ settings: Partial<EnvSettings> }> = [];
  private base: EnvState | null = null;
  private written: EnvState | null = null;

  constructor(private readonly io: EnvIo) {}

  layer(): EnvLayer {
    const entry = { settings: {} as Partial<EnvSettings> };
    let live = false;
    let gone = false;
    return {
      set: (settings) => {
        if (gone) return;
        entry.settings = { ...entry.settings, ...settings };
        if (!live) {
          if (!this.layers.length) this.base = this.io.read();
          this.layers.push(entry);
          live = true;
        }
        this.compose();
      },
      remove: () => {
        gone = true;
        if (!live) return;
        live = false;
        this.layers.splice(this.layers.indexOf(entry), 1);
        this.compose();
      },
    };
  }

  get size(): number {
    return this.layers.length;
  }

  private compose(): void {
    const base = this.base;
    if (!base) return;
    if (!this.layers.length) {
      const now = this.io.read();
      const written = this.written;
      const back = <K extends (typeof KEYS)[number]>(key: K): EnvState[K] => (written && now[key] === written[key] ? base[key] : now[key]);
      this.io.write({ background: back("background"), fog: back("fog"), far: back("far"), exposure: back("exposure") });
      this.base = null;
      this.written = null;
      return;
    }
    const merged: Partial<EnvSettings> = Object.assign({}, ...this.layers.map((layer) => layer.settings));
    const previous = this.written;
    const state: EnvState = {
      background: merged.background === undefined ? base.background : background(merged.background, previous?.background ?? null),
      fog: merged.fog === undefined ? base.fog : fog(merged.fog, previous?.fog ?? null),
      far: merged.far ?? base.far,
      exposure: merged.exposure ?? base.exposure,
    };
    this.io.write(state);
    this.written = state;
  }
}

/** The same colour as last time is the same object, so "is it still ours?" can be asked by identity. */
function background(value: NonNullable<EnvSettings["background"]> | null, previous: EnvState["background"]): EnvState["background"] {
  if (value === null) return null;
  if (value instanceof THREE.Texture) return value;
  const colour = new THREE.Color(value);
  return previous instanceof THREE.Color && previous.equals(colour) ? previous : colour;
}

function fog(value: NonNullable<EnvSettings["fog"]> | null, previous: EnvState["fog"]): EnvState["fog"] {
  if (value === null) return null;
  const made = "density" in value ? new THREE.FogExp2(value.color, value.density) : new THREE.Fog(value.color, value.near, value.far);
  if (previous && previous.color.equals(made.color) && JSON.stringify(previous.toJSON()) === JSON.stringify(made.toJSON())) return previous;
  return made;
}
