import type { Transport } from "./host";
import type { Json, Off, Person } from "./types";

/**
 * SHARED VALUES AND MOMENTS, PER INSTANCE ID, FOR THE WHOLE PAGE. A thing
 * and the space holding it both listen here: the drums' own handler and the
 * concert's ctx.things.drums.onMoment hear the same hit, the player's own at
 * once (mine) and everyone else's as it arrives. The transport carries them
 * between copies (phase 1: the room's relay, moduleState / moduleEvent).
 */
type Watcher = { keys: Set<string>; fn: (value: never, by: Person | null) => void };
type MomentListener = (data: never, info: { from: Person | null; mine: boolean; at: number }) => void;

export type StateFacade = {
  get<T extends Json = Json>(key: string): T | undefined;
  set(key: string, value: Json | undefined): void;
  watch(keys: string | string[], fn: (value: never, by: Person | null) => void): Off;
};

export class EngineBus {
  private readonly values = new Map<string, Map<string, Json>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly moments = new Map<string, Map<string, Set<MomentListener>>>();
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: Transport, private readonly who: (id: string | null) => Person | null, private readonly now: () => number) {
    this.unsubscribe = transport.subscribe((event) => {
      if (event.type === "value") this.apply(event.instance, event.key, event.value, this.who(event.by));
      else this.fire(event.instance, event.name, event.data, { from: this.who(event.from), mine: false, at: this.now() });
    });
  }

  /** What an instance has decided so far, read once per page; `defaults` fill what nobody has set. */
  load(id: string, defaults: Record<string, Json> = {}): Promise<void> {
    let loading = this.loading.get(id);
    if (!loading) {
      loading = this.transport.values(id).catch(() => ({})).then((kept) => {
        const values = this.valuesOf(id);
        for (const [key, value] of Object.entries(kept)) if (!values.has(key)) values.set(key, value);
      });
      this.loading.set(id, loading);
    }
    return loading.then(() => {
      const values = this.valuesOf(id);
      for (const [key, value] of Object.entries(defaults)) if (!values.has(key)) values.set(key, value);
    });
  }

  private valuesOf(id: string): Map<string, Json> {
    let values = this.values.get(id);
    if (!values) {
      values = new Map();
      this.values.set(id, values);
    }
    return values;
  }

  private apply(id: string, key: string, value: Json, by: Person | null): void {
    const values = this.valuesOf(id);
    if (value === null) values.delete(key);
    else values.set(key, value);
    for (const watcher of this.watchers.get(id) ?? []) {
      if (!watcher.keys.has(key)) continue;
      try {
        watcher.fn(value as never, by);
      } catch (error) {
        console.error(`[${id}] watch(${key})`, error);
      }
    }
  }

  state(id: string): StateFacade {
    return {
      get: <T extends Json = Json>(key: string) => this.values.get(id)?.get(key) as T | undefined,
      set: (key, value) => {
        const v = value === undefined ? null : value;
        this.apply(id, key, v, this.who(null));
        this.transport.set(id, key, v);
      },
      watch: (keys, fn) => {
        const watcher: Watcher = { keys: new Set(Array.isArray(keys) ? keys : [keys]), fn };
        let set = this.watchers.get(id);
        if (!set) {
          set = new Set();
          this.watchers.set(id, set);
        }
        set.add(watcher);
        // NOW, with what there is: late arrivals, reloads and models come out right.
        for (const key of watcher.keys) {
          try {
            fn((this.values.get(id)?.get(key) ?? undefined) as never, null);
          } catch (error) {
            console.error(`[${id}] watch(${key})`, error);
          }
        }
        return () => set!.delete(watcher);
      },
    };
  }

  /** A moment of an instance: here first and at once, then to every other copy. */
  moment(id: string, name: string, data: Json): void {
    this.fire(id, name, data, { from: this.who(null), mine: true, at: this.now() });
    this.transport.moment(id, name, data);
  }

  onMoment(id: string, name: string, fn: MomentListener): Off {
    let byName = this.moments.get(id);
    if (!byName) {
      byName = new Map();
      this.moments.set(id, byName);
    }
    let set = byName.get(name);
    if (!set) {
      set = new Set();
      byName.set(name, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  private fire(id: string, name: string, data: Json, info: { from: Person | null; mine: boolean; at: number }): void {
    for (const fn of this.moments.get(id)?.get(name) ?? []) {
      try {
        fn(data as never, info);
      } catch (error) {
        console.error(`[${id}] onMoment(${name})`, error);
      }
    }
  }

  /** An instance and its parts left for good: forget what this page held for them. */
  forget(id: string): void {
    for (const map of [this.values, this.loading, this.watchers, this.moments] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (key === id || key.startsWith(`${id}/`)) map.delete(key);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
