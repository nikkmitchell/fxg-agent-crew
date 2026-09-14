import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimation,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from "@pixiv/three-vrm-animation";
import type { AvatarPosture } from "../../shared/avatar-motion";
import { base } from "../router";

/**
 * The small, deliberately coherent first animation vocabulary.
 *
 * All four clips come from the Overte set converted by Hanami's authors. The
 * animation files are Apache-2.0 derivative works (see public/animations/
 * NOTICE.md); no Hanami application code is copied into this project.
 */
export const AGENT_ANIMATION_FILES = {
  idle: "idle.vrma",
  talking: "idle-talking.vrma",
  thinking: "think-2.vrma",
  walking: "world-walk.vrma",
} as const;

export type AgentAnimationState = keyof typeof AGENT_ANIMATION_FILES;

export function agentAnimationState({
  moving,
  speaking,
  attending,
  posture,
  reducedMotion,
}: {
  moving: boolean;
  speaking: boolean;
  attending: boolean;
  posture: AvatarPosture;
  reducedMotion: boolean;
}): AgentAnimationState {
  // Reduced motion still permits the server-owned root to change position,
  // but it must not add an endlessly repeating body motion around that fact.
  if (reducedMotion) return "idle";
  if (moving) return "walking";
  if (speaking) return "talking";
  if (attending || posture === "thinking") return "thinking";
  return "idle";
}

/**
 * A VRMA walk can translate its hips through the source scene. The room server
 * already owns world position, so applying that translation as well would make
 * feet and body drift ahead of the authoritative avatar root. Keep the useful
 * vertical bounce while pinning horizontal hips translation to frame zero.
 */
export function lockHorizontalHips(clip: THREE.AnimationClip): THREE.AnimationClip {
  const locked = clip.clone();
  for (const track of locked.tracks) {
    if (!(track instanceof THREE.VectorKeyframeTrack) || !track.name.endsWith(".position")) {
      continue;
    }
    const values = track.values;
    const stride = track.getValueSize();
    if (stride < 3 || values.length < 3) continue;
    const x = values[0];
    const z = values[2];
    for (let index = 0; index < values.length; index += stride) {
      values[index] = x;
      values[index + 2] = z;
    }
  }
  return locked;
}

export type AgentAnimationPlayer = {
  update: (delta: number, state: AgentAnimationState, reducedMotion: boolean) => void;
  dispose: () => void;
};

const sourceCache = new Map<AgentAnimationState, Promise<VRMAnimation>>();

function loadAnimation(state: AgentAnimationState): Promise<VRMAnimation> {
  const cached = sourceCache.get(state);
  if (cached) return cached;

  const url = `${base}/animations/${AGENT_ANIMATION_FILES[state]}`;
  const loading = new Promise<VRMAnimation>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    loader.load(
      url,
      (gltf: GLTF) => {
        const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
        if (!animations?.[0]) {
          reject(new Error(`${url} is not a VRM animation`));
          return;
        }
        resolve(animations[0]);
      },
      undefined,
      () => reject(new Error(`the agent animation could not be downloaded: ${url}`)),
    );
  }).catch((error) => {
    sourceCache.delete(state);
    throw error;
  });
  sourceCache.set(state, loading);
  return loading;
}

export async function createAgentAnimationPlayer(vrm: VRM): Promise<AgentAnimationPlayer> {
  // The clip helper can create this itself, but doing it once up front avoids
  // one warning per animated avatar and gives every look-at track one stable
  // target across all four clips.
  if (
    vrm.lookAt &&
    !vrm.scene.children.some((child) => child instanceof VRMLookAtQuaternionProxy)
  ) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = "VRMLookAtQuaternionProxy";
    vrm.scene.add(proxy);
  }

  const entries = await Promise.all(
    (Object.keys(AGENT_ANIMATION_FILES) as AgentAnimationState[]).map(async (state) => {
      const source = await loadAnimation(state);
      const clip = lockHorizontalHips(createVRMAnimationClip(source, vrm));
      clip.name = `agent-${state}`;
      return [state, clip] as const;
    }),
  );

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions = new Map(
    entries.map(([state, clip]) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      return [state, action] as const;
    }),
  );
  let activeState: AgentAnimationState | null = null;

  return {
    update(delta, state, reducedMotion) {
      const next = actions.get(state);
      if (!next) return;
      next.setEffectiveTimeScale(reducedMotion ? 0 : 1);

      if (activeState !== state) {
        const previous = activeState === null ? null : actions.get(activeState) ?? null;
        next.reset().setEffectiveWeight(1).play();
        if (previous) {
          if (reducedMotion) previous.stop();
          else next.crossFadeFrom(previous, 0.32, true);
        }
        activeState = state;
      }

      // update(0) deliberately applies frame zero for reduced-motion users.
      mixer.update(reducedMotion ? 0 : delta);
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(vrm.scene);
    },
  };
}
