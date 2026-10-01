import * as THREE from "three";
import type { PieceAudio } from "./host";

/**
 * WHAT A PAGE GIVES ITS LIVE PIECES FROM THE BROWSER: text drawn on a canvas,
 * and sound through Web Audio. Shared by the saha.ing room and the kit, so a
 * piece reads and sounds the same in both.
 */

/** A line (or lines) of text on a plane, `size` metres per line, facing +z. */
export function makeTextPlane(text: string, size: number, color: string): THREE.Object3D {
  const lines = text.split("\n").slice(0, 8);
  const px = 64;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Object3D();
  const font = `600 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.font = font;
  const width = Math.min(2048, Math.ceil(Math.max(1, ...lines.map((line) => context.measureText(line).width))) + px / 2);
  canvas.width = width;
  canvas.height = Math.ceil(lines.length * px * 1.2);
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = "middle";
  context.textAlign = "center";
  lines.forEach((line, index) => context.fillText(line, width / 2, (index + 0.5) * px * 1.2));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const height = size * lines.length * 1.2;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(height * (canvas.width / canvas.height), height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  return plane;
}

let context: AudioContext | null = null;
const samples = new Map<string, Promise<AudioBuffer>>();

/** Tones and short samples, through one AudioContext for every piece on the page. */
export function webAudio(): PieceAudio {
  const audio = () => {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  };
  return {
    tone({ tone, ms, wave, gain }) {
      const c = audio();
      const at = c.currentTime;
      const end = at + ms / 1000;
      const oscillator = c.createOscillator();
      const level = c.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = tone;
      level.gain.setValueAtTime(0, at);
      level.gain.linearRampToValueAtTime(gain, at + 0.01);
      level.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(level).connect(c.destination);
      oscillator.start(at);
      oscillator.stop(end + 0.05);
    },
    sample(url, gain) {
      const c = audio();
      let buffer = samples.get(url);
      if (!buffer) {
        if (samples.size >= 32) samples.delete(samples.keys().next().value!);
        buffer = fetch(url)
          .then((answer) => (answer.ok ? answer.arrayBuffer() : Promise.reject(new Error(`${answer.status}`))))
          .then((bytes) => c.decodeAudioData(bytes));
        samples.set(url, buffer);
      }
      buffer.then(
        (decoded) => {
          const source = c.createBufferSource();
          const level = c.createGain();
          source.buffer = decoded;
          level.gain.value = gain;
          source.connect(level).connect(c.destination);
          source.start();
        },
        () => samples.delete(url),
      );
    },
  };
}
