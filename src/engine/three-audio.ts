import * as THREE from "three";
import { pageAudioContext } from "./page-audio";

/**
 * three.js PLAYS THROUGH THE PAGE'S ONE CONTEXT (page-audio.ts), not one of its
 * own: imported before anything makes a THREE.AudioListener or asks three for
 * its context (RoomVoices, the Things engine), so there is only ever one.
 */
THREE.AudioContext.setContext(pageAudioContext());

export {};
