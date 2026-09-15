/**
 * Screen sharing, the parts the browser, the server and the room all agree on.
 *
 * Shared so the numbers cannot drift: a size the page encodes to and a size the
 * server refuses at, written in two places, is a share that silently fails the
 * first time somebody's screen has more detail on it than usual.
 */

export const SCREEN_LIMITS = {
  /**
   * The largest frame accepted, in bytes.
   *
   * Nikk's estimate was about 100 KB for a 1280x720 WebP at quality 0.6-0.75.
   * A busy screen full of small text compresses far worse than that, so the cap
   * is fifteen times the estimate: generous for a real frame, and still enough
   * to stop a broken page posting a raw bitmap every second.
   */
  bytes: 1_500_000,
  /**
   * How long a frame counts as live.
   *
   * The page sends one a second. Ten missed seconds is a closed lid, a sleeping
   * tab or a stopped share — past that the room shows nothing rather than a
   * picture that may no longer be what is on the screen.
   */
  staleMs: 10_000,
  /**
   * How long a share link works after its last picture.
   *
   * Twelve hours: long enough that a share left running is never cut off,
   * short enough that a link pasted somewhere it should not have been, and not
   * in use, stops working by morning. Counted from the last upload, not from
   * minting — see `ShareKeys.renew`.
   */
  keyTtlMs: 12 * 60 * 60 * 1000,
  /** What the page captures at. Nikk: "1280 x 720, WebP quality 60-75%, 1 FPS". */
  width: 1280,
  height: 720,
  quality: 0.7,
  intervalMs: 1000,
} as const;

export type ScreenSummary = {
  actorId: string;
  /**
   * The person who put this screen up for `actorId`, or null when the actor
   * shared their own. The room shows it, so a screen shared FOR an agent is
   * never mistaken for one the agent shared itself.
   */
  sharedBy: string | null;
  /** Increments on every frame from anybody, so a viewer can tell a new one from a repeat. */
  seq: number;
  updatedAt: string;
  /**
   * What the actors table says this actor is, when the list is served. The room
   * puts an agent's screen at the agent and nowhere else, and needs to know an
   * agent is one even while that agent is not standing in the room — otherwise
   * its screen would drop back into the row above everybody.
   */
  kind?: "human" | "agent" | null;
};

/**
 * What kind of image these bytes really are, by their signature.
 *
 * The content-type header is the sender's claim; this is what a browser will
 * actually decode. Returns null for anything that is not one of the three
 * formats a screen frame may be.
 */
export function sniffImage(bytes: Uint8Array): "image/webp" | "image/jpeg" | "image/png" | null {
  if (bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  return null;
}

/**
 * Where each shared screen hangs in the room.
 *
 * A ROW ABOVE THE PANEL ARC, facing the same point the panels face. The panels
 * are 2.5 m tall centred at 1.65 m, so their top edge is at 2.9 m; screens sit
 * above that, so a screen never covers a board and both are in view from the
 * spawn point without turning round. PEOPLE'S screens are in one place, side
 * by side, as Nikk first drew it — "Nikk's Screen, Alice's Screen, Bob's
 * Screen". An AGENT'S screen is not in the row: it sits in front of the agent
 * while it works (see AGENT_SCREEN below).
 *
 * SPACED BY A CONSTANT ANGLE, for the reason `arcPlacement` gives: fixing the
 * total spread would squeeze every screen together each time one more person
 * started sharing. The row simply grows wider.
 */
export const SCREEN_ROW = {
  /** The same focus the panel arc uses, so screens face where the panels face. */
  focus: { x: 0, z: 5.2 },
  radius: 7.0,
  /** Centre height: bottom edge at 3.0 m, clear of the panels' 2.9 m top. */
  y: 3.8,
  /**
   * Largest a screen is drawn; the height follows the picture's own shape.
   *
   * 2.8 m, NOT THE 1.6 m IT STARTED AT, and the reason is legibility rather
   * than looks. The first version was checked by looking at it from the spawn
   * point: a test pattern read fine, and a real screen of code would not have.
   * At 1.6 m and eight metres away one headset pixel covers about five pixels
   * of a 1280-wide frame, so ordinary 12 px text is under three pixels tall.
   * At 2.8 m it is roughly twice that — still small, and the way to read a
   * screen closely is to walk up to it, but no longer a blur from where you
   * arrive. Seeing what somebody is working on is the whole point.
   */
  width: 2.8,
  maxHeight: 1.575,
  /** 25 degrees: 2.8 m at 7 m is about 23, so neighbours keep a gap. */
  step: (25 * Math.PI) / 180,
} as const;

export function screenPlacement(index: number, count: number): {
  position: { x: number; y: number; z: number };
  rotationY: number;
} {
  const spread = SCREEN_ROW.step * Math.max(0, count - 1);
  const turn = count < 2 ? 0 : -spread / 2 + SCREEN_ROW.step * index;
  return {
    position: {
      x: SCREEN_ROW.focus.x + SCREEN_ROW.radius * Math.sin(turn),
      y: SCREEN_ROW.y,
      z: SCREEN_ROW.focus.z - SCREEN_ROW.radius * Math.cos(turn),
    },
    // A plane with no rotation faces +z, and the focus is +z of every point on
    // the row, so turning by -turn faces it.
    rotationY: -turn,
  };
}

/**
 * The size a screen is drawn at, keeping the picture's own shape.
 *
 * NEVER STRETCHED. label-aspect.test.ts records what mapping a picture onto a
 * plane of a different shape does: "it STRETCHES it, and the failure looks like
 * blurring rather than like a mistake". A shared window can be any shape at
 * all — a tall terminal, an ultrawide monitor — so the plane takes the
 * picture's aspect, bounded by the row's width and height.
 */
export function screenSize(
  imageWidth: number,
  imageHeight: number,
  bounds: { width: number; maxHeight: number } = SCREEN_ROW,
): { width: number; height: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return { width: bounds.width, height: bounds.maxHeight };
  const aspect = imageWidth / imageHeight;
  let width = bounds.width;
  let height = width / aspect;
  if (height > bounds.maxHeight) {
    height = bounds.maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

/**
 * The size to capture at, fitting the source inside 1280x720 without
 * stretching it and without ever enlarging it.
 */
export function captureSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { width: SCREEN_LIMITS.width, height: SCREEN_LIMITS.height };
  const scale = Math.min(1, SCREEN_LIMITS.width / sourceWidth, SCREEN_LIMITS.height / sourceHeight);
  return { width: Math.max(1, Math.round(sourceWidth * scale)), height: Math.max(1, Math.round(sourceHeight * scale)) };
}

/** How the room names a screen: whose it is, and who put it up if that differs. */
export function screenLabel(summary: Pick<ScreenSummary, "actorId" | "sharedBy">): string {
  const sharer = summary.sharedBy;
  if (!sharer || sharer.trim().toLowerCase() === summary.actorId.trim().toLowerCase()) {
    return `${summary.actorId}'s screen`;
  }
  return `${summary.actorId}'s screen · shared by ${sharer}`;
}

/**
 * An AGENT'S screen sits in front of the agent, not in the row above the boards.
 *
 * Nikk, from inside the room: "if an agent has their screen being shared it
 * doesn't just float super high up above us... when the agent is actually
 * working on anything... they pop up their screen... and then their screen can
 * disappear if they go walk to the mood board or walk to the job board... once
 * they finish... they can go back to their space and then they reopen their
 * screen." And: "if I look over an agent I can see the screen in front of them".
 *
 * A monitor in front of whoever is using it. Agents are drawn at half height,
 * so their eyes are near 0.8 m; the screen spans about 0.65–1.25 m around that,
 * which puts it in a standing person's line of sight when looking over the
 * agent's shoulder as well as in front of the agent itself.
 */
export const AGENT_SCREEN = {
  /** How far in front of the agent, along the way it is facing. */
  ahead: 0.55,
  /** Centre height. */
  y: 0.95,
  /** A personal monitor, well short of the 2.8 m wall screens. */
  width: 1.1,
  maxHeight: 0.62,
} as const;

/**
 * Where an agent's screen goes, given where the agent stands and faces.
 *
 * AN AGENT FACING `f` LOOKS ALONG (-sin f, 0, -cos f): the room's forward is
 * -Z and `facingToward` in presence.ts is atan2(from - to). So the screen is
 * placed that way. A plane turned by `f` faces back toward the agent, which is
 * the side the agent reads; the other side is drawn too — see ScreenWall.
 */
export function agentScreenPose(at: { x: number; z: number }, facing: number): {
  position: { x: number; y: number; z: number };
  rotationY: number;
} {
  return {
    position: {
      x: at.x - Math.sin(facing) * AGENT_SCREEN.ahead,
      y: AGENT_SCREEN.y,
      z: at.z - Math.cos(facing) * AGENT_SCREEN.ahead,
    },
    rotationY: facing,
  };
}

/**
 * Whether an agent's shared screen should be showing right now.
 *
 * ONLY WHILE IT IS WORKING AT ITS OWN SPACE, in Nikk's words. Every signal here
 * is one the room already has, rather than a new thing agents must report:
 *
 *   - not walking — the screen goes away while it crosses the room
 *   - not at a board — `because` says why it is somewhere else ("commented on
 *     a card", "was checking tasks"), and is null at the agent's own space,
 *     whether that is its desk or a home somebody placed it at.
 *   - working — its posture is `thinking`, which the server infers for five
 *     minutes after it last did something, or it has declared it is composing
 *     a reply. An agent that has gone quiet is `sleeping`, and its screen with it.
 *
 * Frames arriving is NOT evidence of work: a share left running would keep a
 * screen up all day over an agent that did nothing, which is exactly what this
 * exists to stop.
 */
export function agentScreenShown(person: {
  moving: boolean;
  because: string | null;
  attending: unknown;
  avatar?: { posture?: string } | null;
}): boolean {
  if (person.moving) return false;
  if (person.because !== null) return false;
  return person.avatar?.posture === "thinking" || (person.attending !== null && person.attending !== undefined);
}
