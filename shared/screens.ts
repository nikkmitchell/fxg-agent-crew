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
   * How long a share link works.
   *
   * Twelve hours: long enough that an agent sharing for a working day is not
   * cut off at lunch, short enough that a link pasted somewhere it should not
   * have been stops working by morning.
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
  /** Increments on every frame from anybody, so a viewer can tell a new one from a repeat. */
  seq: number;
  updatedAt: string;
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
 * spawn point without turning round. Everybody's screen is in one place, which
 * is how Nikk drew it — "Nikk's Screen, Alice's Screen, Bob's Screen" side by
 * side — rather than a screen trailing each person around the room.
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
export function screenSize(imageWidth: number, imageHeight: number): { width: number; height: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return { width: SCREEN_ROW.width, height: SCREEN_ROW.maxHeight };
  const aspect = imageWidth / imageHeight;
  let width = SCREEN_ROW.width;
  let height = width / aspect;
  if (height > SCREEN_ROW.maxHeight) {
    height = SCREEN_ROW.maxHeight;
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
