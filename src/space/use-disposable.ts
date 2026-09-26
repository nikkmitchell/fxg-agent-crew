import { useEffect, useMemo, type DependencyList } from "react";

type Disposable = { dispose(): void };

/**
 * A GPU RESOURCE THAT IS FREED WHEN IT IS REPLACED OR THE COMPONENT GOES.
 *
 * `useMemo(() => makeLabelTexture(text), [text])` was the pattern all over the
 * room, and it leaks: three.js keeps a texture or geometry on the GPU until
 * `dispose()` is called, and React never calls it. Each avatar baked a new
 * texture for every line it said and kept every one; each button baked a new
 * one whenever its label changed, and the voice status line changes several
 * times a send. In a long headset session that is GPU memory that only grows.
 *
 * R3F disposes what it creates from JSX (`<boxGeometry />`), not objects handed
 * to it through props (`map={texture}`, `geometry={torso}`). Those go through
 * here.
 */
export function useDisposable<T extends Disposable | null>(make: () => T, deps: DependencyList): T {
  // The caller's deps are the contract, exactly as with useMemo.
  const value = useMemo(make, deps);
  useEffect(() => () => value?.dispose(), [value]);
  return value;
}

/** Every object in a list, freed together: for pools built once per mount. */
export function useDisposableList<T>(make: () => T[], disposeOne: (item: T) => void): T[] {
  // Built once per mount, by design.
  const list = useMemo(make, []);
  useEffect(() => () => list.forEach(disposeOne), [list]);
  return list;
}
