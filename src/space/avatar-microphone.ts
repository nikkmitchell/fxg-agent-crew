/** Share an active room call's microphone without interrupting that call. */
export async function avatarMicrophone(
  callMicrophone: () => MediaStream | null,
  inCall: boolean,
  devices: Pick<MediaDevices, "getUserMedia"> | undefined = navigator.mediaDevices,
): Promise<MediaStream> {
  const lent = callMicrophone()?.getAudioTracks().find((track) => track.readyState === "live");
  if (inCall && !lent) throw new Error("The room call's microphone is not ready. Try again in a moment.");
  if (lent) {
    const copy = lent.clone();
    try { return new MediaStream([copy]); }
    catch (error) { copy.stop(); throw error; }
  }
  if (!devices?.getUserMedia) throw new Error("This browser cannot record microphone audio.");
  return devices.getUserMedia({ audio: true });
}
