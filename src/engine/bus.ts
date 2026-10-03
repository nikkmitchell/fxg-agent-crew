import type { Transport } from "./host";
import type { Json, Off, Person } from "./types";

/**
 * SHARED VALUES AND MOMENTS, PER INSTANCE ID, FOR THE WHOLE PAGE. A thing
 * and the space holding it both listen here: the drums' own handler and the
 * concert's ctx.things.drums.onMoment hear the same hit, the player's own at
 * once (mine) and everyone else's as it arrives. The transport carries them
 * between copies (phase 1: the room's relay, moduleState / moduleEvent).
 *
 * What is kept is only what somebody set. A definition's `shared` defaults
 * are read through, never stored, so a push that changes a default changes it
 * for every copy, and setting a value to null brings its default back.
 */
type Watcher = { keys: Set<string>; fn: (value: never, by: Person | null) => void };
type MomentListener = (data: never, info: { from: Person | null; mine: boolean; at: number }) => void;

export type StateFacade = {
  get<T extends Json = Json>(key: string): T | undefined;
  set(key: string, value: Json | undefined): void;
  watch(keys: string | string[], fn: (value: never, by: Person | null) => void): Off;
};

export type BusOptions = {
  who: (id: string | null) => Person | null;
  now: () => number;
  /** Something arrived from another copy: a host that draws on demand draws again. */
  arrived?: () => void;
  /** A write or moment this transport cannot carry, said on the thing's badge rather than lost. */
  problem?: (instance: string, text: string) => void;
};

export class EngineBus {
  private readonly values = new Map<string, Map<string, Json>>();
  private readonly defaults = new Map<string, Record<string, Json>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly watchers = new Map<string, Set<Watcher>>();
  private readonly moments = new Map<string, Map<string, Set<MomentListener>>>();
  /** Keys this page set while the transport could not carry them, sent again when it can. */
  private readonly unsent = new Map<string, Map<string, Json>>();
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: Transport, private readonly options: BusOptions) {
    this.unsubscribe = transport.subscribe((event) => {
      if (event.type === "value") this.apply(event.instance, event.key, event.value, this.options.who(event.by));
      else this.fire(event.instance, event.name, event.data, { from: this.options.who(event.from), mine: false, at: this.options.now() });
      this.options.arrived?.();
    });
  }

  /** What an instance has decided so far, read once per page; `defaults` are what nobody has set reads as. */
  load(id: string, defaults: Record<string, Json> = {}): Promise<void> {
    // The newest version's defaults: a push that changes one changes it here too.
    const before = this.defaults.get(id);
    this.defaults.set(id, defaults);
    if (before) this.defaultsChanged(id, before, defaults);
    let loading = this.loading.get(id);
    if (!loading) {
      loading = this.transport.values(id).catch(() => ({})).then((kept) => this.merge(id, kept, false));
      this.loading.set(id, loading);
    }
    return loading;
  }

  /**
   * What the server keeps now, for every instance this page has loaded: after
   * the room's socket comes back, anything missed while it was down. Writes
   * made while it was down go first; a server that has forgotten everything
   * (it restarted) is told again what this copy holds.
   */
  async resync(): Promise<void> {
    const unsent = new Map(this.unsent);
    this.unsent.clear();
    for (const [id, keys] of unsent) for (const [key, value] of keys) this.send(id, key, value);
    await Promise.all([...this.loading.keys()].map(async (id) => {
      let kept: Record<string, Json>;
      try {
        kept = await this.transport.values(id);
      } catch {
        return;
      }
      const mine = this.values.get(id);
      if (!Object.keys(kept).length && mine?.size) {
        for (const [key, value] of mine) this.send(id, key, value);
        return;
      }
      this.merge(id, kept, true, new Set(unsent.get(id)?.keys() ?? []));
    }));
  }

  /** Kept values in; watchers hear every key that changed. `exact`: keys the server no longer has are gone. */
  private merge(id: string, kept: Record<string, Json>, exact: boolean, skip: Set<string> = new Set()): void {
    const values = this.valuesOf(id);
    const changed: string[] = [];
    for (const [key, value] of Object.entries(kept)) {
      if (skip.has(key)) continue;
      // On first load, a value that arrived over the socket meanwhile is fresher than the answer.
      if (!exact && values.has(key)) continue;
      if (JSON.stringify(values.get(key)) === JSON.stringify(value)) continue;
      values.set(key, value);
      changed.push(key);
    }
    if (exact) {
      for (const key of [...values.keys()]) {
        if (key in kept || skip.has(key)) continue;
        values.delete(key);
        changed.push(key);
      }
    }
    for (const key of changed) this.notify(id, key, null);
  }

  private defaultsChanged(id: string, before: Record<string, Json>, after: Record<string, Json>): void {
    const values = this.values.get(id);
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (values?.has(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      this.notify(id, key, null);
    }
  }

  private valuesOf(id: string): Map<string, Json> {
    let values = this.values.get(id);
    if (!values) {
      values = new Map();
      this.values.set(id, values);
    }
    return values;
  }

  private read(id: string, key: string): Json | undefined {
    const values = this.values.get(id);
    if (values?.has(key)) return values.get(key);
    return this.defaults.get(id)?.[key];
  }

  private apply(id: string, key: string, value: Json, by: Person | null): void {
    const values = this.valuesOf(id);
    if (value === null) values.delete(key);
    else values.set(key, value);
    this.notify(id, key, by);
  }

  private notify(id: string, key: string, by: Person | null): void {
    const value = this.read(id, key);
    for (const watcher of this.watchers.get(id) ?? []) {
      if (!watcher.keys.has(key)) continue;
      try {
        watcher.fn(value as never, by);
      } catch (error) {
        console.error(`[${id}] watch(${key})`, error);
      }
    }
  }

  private send(id: string, key: string, value: Json): void {
    if (this.transport.set(id, key, value) !== false) {
      this.unsent.get(id)?.delete(key);
      return;
    }
    let keys = this.unsent.get(id);
    if (!keys) {
      keys = new Map();
      this.unsent.set(id, keys);
    }
    keys.set(key, value);
  }

  state(id: string): StateFacade {
    return {
      get: <T extends Json = Json>(key: string) => this.read(id, key) as T | undefined,
      set: (key, value) => {
        const v = value === undefined ? null : value;
        const refused = this.transport.check?.(id, key, v);
        if (refused) {
          this.options.problem?.(id, `ctx.state.set("${key}"): ${refused}`);
          return;
        }
        this.apply(id, key, v, this.options.who(null));
        this.send(id, key, v);
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
            fn(this.read(id, key) as never, null);
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
    const refused = this.transport.check?.(id, name, data);
    if (refused) {
      this.options.problem?.(id, `ctx.net.moment("${name}"): ${refused}`);
      return;
    }
    this.fire(id, name, data, { from: this.options.who(null), mine: true, at: this.options.now() });
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
    for (const map of [this.values, this.defaults, this.loading, this.watchers, this.moments, this.unsent] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (key === id || key.startsWith(`${id}/`)) map.delete(key);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }
}
