import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM } from "@pixiv/three-vrm";
import {
  createVRMAnimationClip,
  VRMAnimation,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from "@pixiv/three-vrm-animation";
import type {
  ActiveAvatarGesture,
  AvatarMood,
  AvatarPosture,
} from "../../shared/avatar-motion";
import { base } from "../router";

/**
 * A curated animation vocabulary rather than a raw file browser.
 *
 * The files are Hanami's VRM 1.0 conversions of separately licensed Overte
 * and Microsoft Rocketbox animations. The application code is not used. The
 * complete attribution and per-file source table travel with the clips in
 * public/animations/NOTICE.md.
 */
export const AGENT_ANIMATION_FILES = {
  idle: "idle.vrma",
  idleCalm: "idle-2.vrma",
  idleShift: "idle-3.vrma",
  idleAware: "idle-4.vrma",
  talking: "idle-talking.vrma",
  talkingOpen: "idle-talking-5.vrma",
  talkingLeft: "idle-talking-6.vrma",
  talkingRight: "idle-talking-7.vrma",
  thinking: "rb-think.vrma",
  thinkingAlt: "rb-think-2.vrma",
  listening: "rb-listen.vrma",
  listeningAlt: "rb-listen-2.vrma",
  relaxed: "relaxed-3.vrma",
  celebrating: "happy-6.vrma",
  walkingSlow: "world-walk-slow.vrma",
  walking: "world-walk.vrma",
  walkingFast: "world-walk-fast.vrma",
  walkStart: "world-walk-start.vrma",
  walkStop: "world-walk-stop.vrma",
  gestureWave: "rb-wave.vrma",
  gestureNod: "nod-2.vrma",
  gesturePresent: "world-point-in.vrma",
  gestureClap: "happy-6.vrma",
  gestureShrug: "rb-shrug.vrma",
  gestureDisagree: "shake.vrma",
} as const;

export type AgentAnimationClip = keyof typeof AGENT_ANIMATION_FILES;
export type AgentAnimationState =
  | "idle"
  | "talking"
  | "thinking"
  | "listening"
  | "presenting"
  | "celebrating"
  | "relaxed"
  | "walking";

export type AgentAnimationSelection = {
  state: AgentAnimationState;
  clip: AgentAnimationClip;
  gestureClip: AgentAnimationClip | null;
  gestureToken: number | null;
};

type AgentAnimationInput = {
  actorId: string;
  moving: boolean;
  speaking: boolean;
  attending: boolean;
  mood: AvatarMood;
  posture: AvatarPosture;
  gesture: ActiveAvatarGesture | null;
  gestureStartedAt: number | null;
  reducedMotion: boolean;
  nowMs: number;
};

const STATE_POOLS: Record<AgentAnimationState, readonly AgentAnimationClip[]> = {
  idle: ["idle", "idleCalm", "idleShift", "idleAware"],
  talking: ["talking", "talkingOpen", "talkingLeft", "talkingRight"],
  thinking: ["thinking", "thinkingAlt"],
  listening: ["listening", "listeningAlt"],
  presenting: ["talkingOpen", "talkingLeft", "talkingRight"],
  celebrating: ["celebrating"],
  relaxed: ["relaxed", "idleCalm"],
  walking: ["walking"],
};

const VARIANT_PERIOD_MS: Record<AgentAnimationState, number> = {
  idle: 30_000,
  talking: 12_000,
  thinking: 18_000,
  listening: 18_000,
  presenting: 12_000,
  celebrating: 30_000,
  relaxed: 24_000,
  walking: 30_000,
};

const GESTURE_CLIPS: Record<ActiveAvatarGesture, AgentAnimationClip> = {
  wave: "gestureWave",
  nod: "gestureNod",
  present: "gesturePresent",
  clap: "gestureClap",
  shrug: "gestureShrug",
  disagree: "gestureDisagree",
};

const hash = (value: string): number => [...value].reduce(
  (accumulated, character) =>
    Math.imul(accumulated ^ character.charCodeAt(0), 16_777_619) >>> 0,
  2_166_136_261,
);

/**
 * Vary long-running poses without putting the whole room on one timer edge.
 * The actor-derived offset means two agents do not change pose in lockstep.
 */
export function animationVariant(
  state: AgentAnimationState,
  actorId: string,
  nowMs: number,
): AgentAnimationClip {
  const pool = STATE_POOLS[state];
  const period = VARIANT_PERIOD_MS[state];
  const offset = hash(`${actorId}:${state}:offset`) % period;
  const sequence = Math.floor((nowMs + offset) / period);
  return pool[hash(`${actorId}:${state}:${sequence}`) % pool.length];
}

export function agentAnimationState({
  moving,
  speaking,
  attending,
  posture,
  reducedMotion,
}: Pick<
  AgentAnimationInput,
  "moving" | "speaking" | "attending" | "posture" | "reducedMotion"
>): AgentAnimationState {
  if (reducedMotion) return "idle";
  if (moving) return "walking";
  if (posture === "celebrating") return "celebrating";
  if (speaking) return posture === "presenting" ? "presenting" : "talking";
  if (attending || posture === "listening") return "listening";
  if (posture === "thinking") return "thinking";
  if (posture === "presenting") return "presenting";
  if (posture === "relaxed") return "relaxed";
  return "idle";
}

/** Resolve room facts and a bounded self-declaration to one playable plan. */
export function agentAnimationSelection(input: AgentAnimationInput): AgentAnimationSelection {
  const state = agentAnimationState(input);
  let clip: AgentAnimationClip = input.reducedMotion
    ? "idle"
    : animationVariant(state, input.actorId, input.nowMs);

  // The root remains server-owned. Mood only chooses the character of the gait.
  if (state === "walking") {
    if (input.mood === "focused" || input.mood === "happy") clip = "walkingFast";
    else if (input.mood === "concerned") clip = "walkingSlow";
    else clip = "walking";
  }

  // A full-body gesture while walking makes the feet perform one action while
  // the root performs another. Hold it until arrival if it is still live.
  const canGesture = !input.reducedMotion && !input.moving && input.gesture !== null;
  return {
    state,
    clip,
    gestureClip: canGesture ? GESTURE_CLIPS[input.gesture!] : null,
    gestureToken: canGesture ? input.gestureStartedAt : null,
  };
}

/** Dedicated authored clips make starts and stops read as decisions, not pops. */
export function transitionClip(
  previous: AgentAnimationState,
  next: AgentAnimationState,
): AgentAnimationClip | null {
  if (previous !== "walking" && next === "walking") return "walkStart";
  if (previous === "walking" && next !== "walking") return "walkStop";
  return null;
}

/** Keep vertical bounce while removing source-scene horizontal hips travel. */
export function lockHorizontalHips(clip: THREE.AnimationClip): THREE.AnimationClip {
  const locked = clip.clone();
  for (const track of locked.tracks) {
    if (!(track instanceof THREE.VectorKeyframeTrack) || !track.name.endsWith(".position")) continue;
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
  update: (delta: number, selection: AgentAnimationSelection, reducedMotion: boolean) => void;
  dispose: () => void;
};

const sourceCache = new Map<string, Promise<VRMAnimation>>();

function loadAnimation(clip: AgentAnimationClip): Promise<VRMAnimation> {
  const file = AGENT_ANIMATION_FILES[clip];
  const cached = sourceCache.get(file);
  if (cached) return cached;

  const url = `${base}/animations/${file}`;
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
    sourceCache.delete(file);
    throw error;
  });
  sourceCache.set(file, loading);
  return loading;
}

type OneShot = {
  action: THREE.AnimationAction;
  kind: "transition" | "gesture";
};

export async function createAgentAnimationPlayer(vrm: VRM): Promise<AgentAnimationPlayer> {
  if (
    vrm.lookAt &&
    !vrm.scene.children.some((child) => child instanceof VRMLookAtQuaternionProxy)
  ) {
    const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
    proxy.name = "VRMLookAtQuaternionProxy";
    vrm.scene.add(proxy);
  }

  const entries = await Promise.all(
    (Object.keys(AGENT_ANIMATION_FILES) as AgentAnimationClip[]).map(async (key) => {
      const source = await loadAnimation(key);
      const clip = lockHorizontalHips(createVRMAnimationClip(source, vrm));
      clip.name = `agent-${key}`;
      return [key, clip] as const;
    }),
  );

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const actions = new Map(
    entries.map(([key, clip]) => {
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      return [key, action] as const;
    }),
  );

  let activeAction: THREE.AnimationAction | null = null;
  let activeBaseClip: AgentAnimationClip | null = null;
  let activeBaseState: AgentAnimationState | null = null;
  let activeOneShot: OneShot | null = null;
  let pending: AgentAnimationSelection | null = null;
  let lastGestureToken: number | null = null;
  let frozen = false;

  const activateBase = (selection: AgentAnimationSelection, fade = 0.28) => {
    const next = actions.get(selection.clip);
    if (!next) return;
    if (activeAction === next && activeBaseClip === selection.clip) {
      activeBaseState = selection.state;
      return;
    }
    const previous = activeAction;
    next.enabled = true;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous && previous !== next) {
      previous.fadeOut(fade);
      next.fadeIn(fade);
    }
    activeAction = next;
    activeBaseClip = selection.clip;
    activeBaseState = selection.state;
  };

  const beginOneShot = (clip: AgentAnimationClip, kind: OneShot["kind"]) => {
    const action = actions.get(clip);
    if (!action) return;
    const previous = activeAction;
    action.enabled = true;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
    if (previous && previous !== action) {
      previous.fadeOut(kind === "gesture" ? 0.18 : 0.12);
      action.fadeIn(kind === "gesture" ? 0.18 : 0.12);
    }
    activeAction = action;
    activeOneShot = { action, kind };
  };

  const onFinished = (event: { action: THREE.AnimationAction }) => {
    if (!activeOneShot || event.action !== activeOneShot.action) return;
    activeOneShot = null;
    activeAction = null;
    if (pending) activateBase(pending, 0.22);
  };
  mixer.addEventListener("finished", onFinished);

  return {
    update(delta, selection, reducedMotion) {
      pending = selection;

      if (reducedMotion) {
        if (!frozen) {
          mixer.stopAllAction();
          const idle = actions.get("idle");
          idle?.reset().setEffectiveWeight(1).setEffectiveTimeScale(0).play();
          activeAction = idle ?? null;
          activeBaseClip = "idle";
          activeBaseState = "idle";
          activeOneShot = null;
          frozen = true;
          mixer.update(0);
        }
        return;
      }

      if (frozen) {
        mixer.stopAllAction();
        activeAction = null;
        activeBaseClip = null;
        activeBaseState = null;
        activeOneShot = null;
        frozen = false;
      }

      if (!activeOneShot) {
        if (activeBaseState === null || activeBaseClip === null) {
          activateBase(selection, 0);
        } else if (activeBaseState !== selection.state || activeBaseClip !== selection.clip) {
          const transition = transitionClip(activeBaseState, selection.state);
          if (transition) beginOneShot(transition, "transition");
          else activateBase(selection);
        }

        if (
          !activeOneShot &&
          selection.gestureClip &&
          selection.gestureToken !== null &&
          selection.gestureToken !== lastGestureToken
        ) {
          lastGestureToken = selection.gestureToken;
          beginOneShot(selection.gestureClip, "gesture");
        }
      }

      mixer.update(delta);
    },
    dispose() {
      mixer.removeEventListener("finished", onFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(vrm.scene);
    },
  };
}
