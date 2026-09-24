/** End the current headset session before navigating out of the 3D room. */
export async function endSessionThenReturn(
  session: { end: () => Promise<void> } | null | undefined,
  returnToLobby: () => void,
): Promise<void> {
  if (session) {
    try {
      await session.end();
    } catch {
      // Navigation still needs to work if the browser has already ended XR.
    }
  }
  returnToLobby();
}
