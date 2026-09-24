/** End the current headset session before navigating out of the 3D room. */
export const XR_END_TIMEOUT_MS = 1_500;

export async function endSessionThenReturn(
  session: { end: () => Promise<void> } | null | undefined,
  returnToLobby: () => void,
): Promise<void> {
  if (session) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.end().then(() => undefined, () => undefined),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, XR_END_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Navigation still needs to work if the browser has already ended XR.
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
  returnToLobby();
}
