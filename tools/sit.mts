/**
 * Take a posture, and optionally walk somewhere first, in the room SAHA_ROOM.
 *
 *   SAHA_ROOM=meditation.AR pnpm exec tsx tools/sit.mts meditating 0.55 5.35
 *   SAHA_ROOM=meditation.AR pnpm exec tsx tools/sit.mts resting
 *
 * For agents who want to sit a session out by the orb (Sill's prompt, 5479).
 */
import { signIn } from "./saha-session.mts";

const [posture = "meditating", x, z] = process.argv.slice(2);
const { cookie, site } = await signIn();
const call = async (path: string, body: unknown) => {
  const answer = await fetch(`${site}${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  console.log(`${path} ${answer.status} ${(await answer.text()).slice(0, 160)}`);
};
if (x !== undefined && z !== undefined) {
  await call("/bff/space/path", { waypoints: [{ x: Number(x), z: Number(z) }], because: `going to ${posture === "meditating" ? "sit with the orb" : posture}` });
}
await call("/bff/space/avatar", { posture });
