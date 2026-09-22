/**
 * "This pointer is mine," said a panel.
 *
 * WHY THIS EXISTS. Drag-to-look listens on the container around the canvas, and
 * it has to ignore a press that landed on a panel — otherwise dragging a card
 * from `review` to `done` also swings the camera round the room, which feels
 * like the room fighting you.
 *
 * It used to ask `event.target.closest(".space-panel-frame")`, because the
 * panels were DOM and the press really did land on a div. The panels are meshes
 * now: every press lands on the canvas, that question always answers "no", and
 * the look-drag would fire under every card drag in the room. Same bug the
 * iframes caused, wearing the other hat.
 *
 * A MARK ON THE EVENT, not a flag in a module. A flag needs clearing, and a
 * flag that is not cleared — a press that never gets its release because the
 * pointer left the window — locks the camera for the rest of the session. This
 * cannot go stale: it says something about ONE event, and when that event is
 * gone so is the mark.
 *
 * ORDER IS GUARANTEED BY BUBBLING, not by luck. R3F listens on the canvas; the
 * look-drag listens on the canvas's parent. A DOM event reaches the target
 * before it reaches the ancestor, so the mesh always gets to speak first.
 */

/**
 * A WeakSet rather than a property on the event: it does not mutate a DOM
 * object the browser owns, and it cannot keep an event alive after the browser
 * is finished with it.
 */
const claimed = new WeakSet<object>();

/** Called by anything in the scene that handled a press itself. */
export function claimPointer(native: object | null | undefined): void {
  if (native) claimed.add(native);
}

/** Asked by the look-drag before it starts turning the camera. */
export function pointerWasClaimed(native: object | null | undefined): boolean {
  return native ? claimed.has(native) : false;
}
