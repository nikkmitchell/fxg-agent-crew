import { performance } from "node:perf_hooks";
import { GO_SIZES } from "../shared/room-items.ts";
import { goRockGeometry } from "../src/space/go-rock-geometry.ts";

// CPU construction and cache timings, not a headset frame-rate benchmark.
for (const size of GO_SIZES) {
  const start = performance.now(), geometry = goRockGeometry(size);
  const built = performance.now(), cached = goRockGeometry(size), end = performance.now();
  console.log(JSON.stringify({ size, vertices: geometry.getAttribute("position").count,
    triangles: geometry.index!.count / 3, buildMs: Math.round(built - start), cachedMs: +(end - built).toFixed(2) }));
  geometry.dispose(); cached.dispose();
}
