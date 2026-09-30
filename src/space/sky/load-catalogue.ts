import asset from "./hyg-bright.bin?url";
import { decodeSkyCatalogue } from "../../../shared/sky-catalogue";

let pending: Promise<number[][]> | undefined;
/** One static asset, shared by all local sky views and React remounts. */
export function loadSkyCatalogue(): Promise<number[][]> {
  pending ??= fetch(asset).then(async (response) => {
    if (!response.ok) throw new Error(`Sky catalogue failed to load (${response.status})`);
    return decodeSkyCatalogue(await response.arrayBuffer());
  }).catch((error) => { pending = undefined; throw error; });
  return pending;
}
