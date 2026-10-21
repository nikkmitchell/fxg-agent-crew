import * as THREE from "three";
import { pageAudioContext } from "./page-audio";

/**
 * three.js PLAYS THROUGH THE PAGE'S ONE CONTEXT (page-audio.ts), not one of its
 * own. Imported before anything makes a THREE.AudioListener or asks three for
 * its context (RoomVoices, the Things engine), so there is only ever one.
 *
 * Lazily, as three does it: the context is made when something first asks for
 * it, not when this is imported, so a page that never plays a sound (or a test
 * with no Web Audio at all) never makes one.
 */
THREE.AudioContext.getContext = () => pageAudioContext();

export {};
