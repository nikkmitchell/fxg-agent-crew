import * as THREE from "three";
import { easeSky } from "../../shared/earth-sky";
import { RAIN_RETREAT, retreatDrops } from "../../shared/rain-retreat";

/** A preview variant of the existing rain curtain; no room state or model calls. */
export class RainRetreatView {
  readonly group = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly drops: THREE.ShaderMaterial;
  private readonly patch: THREE.ShaderMaterial;
  private readonly ripples: THREE.ShaderMaterial;
  private readonly seat: THREE.MeshBasicMaterial;
  private opacity = 0;
  private time = 0;
  private sound: { ctx: AudioContext; source: AudioBufferSourceNode; gain: GainNode; filters: BiquadFilterNode[] } | null = null;
  private soundEnabled = false;
  private disposed = false;
  private lastSoundLevel = -1;

  constructor(at: { x: number; z: number }) {
    this.group.position.set(at.x, 0, at.z);
    const seeds = retreatDrops();
    const base = new THREE.BoxGeometry(.003, .13, .003);
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = base.index!.clone();
    for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute.clone());
    base.dispose();
    const starts = new Float32Array(seeds.length * 2), phases = new Float32Array(seeds.length * 2);
    seeds.forEach((drop, i) => { starts.set([drop.x, drop.z], i * 2); phases.set([drop.offset, drop.speed], i * 2); });
    geometry.setAttribute("dropAt", new THREE.InstancedBufferAttribute(starts, 2));
    geometry.setAttribute("phaseSpeed", new THREE.InstancedBufferAttribute(phases, 2));
    geometry.instanceCount = seeds.length;
    this.drops = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: `attribute vec2 dropAt; attribute vec2 phaseSpeed; uniform float uTime;
        void main(){
          float y=2.8*(1.-fract(uTime*phaseSpeed.y*1.45+phaseSpeed.x));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position+vec3(dropAt.x,y,dropAt.y),1.);
        }`,
      fragmentShader: `uniform float uFade; void main(){gl_FragColor=vec4(.56,.7,.83,uFade*.42);
        #include <colorspace_fragment>
      }`,
    });
    const rain = new THREE.Mesh(geometry, this.drops);
    rain.frustumCulled = false; rain.raycast = () => {};
    this.group.add(rain);

    // One wet ground surface. Individual landing ripples share one tiny draw.
    const patchGeometry = new THREE.CircleGeometry(RAIN_RETREAT.outer + .15, 64);
    this.patch = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: `varying vec2 vAt; void main(){vAt=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vAt; uniform float uTime; uniform float uFade;
        void main(){
          float radius=length(vAt), wet=smoothstep(.76,.9,radius)*(1.-smoothstep(1.55,1.75,radius));
          gl_FragColor=vec4(.016,.036,.048,wet*uFade*.72);
          #include <colorspace_fragment>
        }`,
    });
    const patch = new THREE.Mesh(patchGeometry, this.patch);
    patch.rotation.x = -Math.PI / 2; patch.position.y = .009; patch.raycast = () => {};
    this.group.add(patch);
    const rippleBase = new THREE.PlaneGeometry(1, 1);
    const rippleGeometry = new THREE.InstancedBufferGeometry();
    rippleGeometry.index = rippleBase.index!.clone();
    for (const [name, attribute] of Object.entries(rippleBase.attributes)) rippleGeometry.setAttribute(name, attribute.clone());
    rippleBase.dispose();
    rippleGeometry.setAttribute("dropAt", new THREE.InstancedBufferAttribute(starts, 2));
    rippleGeometry.setAttribute("phaseSpeed", new THREE.InstancedBufferAttribute(phases, 2));
    rippleGeometry.instanceCount = seeds.length;
    this.ripples = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 } },
      vertexShader: `attribute vec2 dropAt; attribute vec2 phaseSpeed; uniform float uTime;
        varying vec2 vUv; varying float vLife;
        void main(){vUv=uv; vLife=fract(uTime*phaseSpeed.y*1.45+phaseSpeed.x);
          float radius=.018+min(vLife/.65,1.)*.21;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(dropAt.x+position.x*radius*2.,.012,dropAt.y+position.y*radius*2.,1.);
        }`,
      fragmentShader: `varying vec2 vUv; varying float vLife; uniform float uFade;
        void main(){float r=length(vUv-.5)*2.;
          float ring=smoothstep(.68,.82,r)*(1.-smoothstep(.9,1.,r));
          float landing=exp(-r*r*24.)*(1.-smoothstep(0.,.09,vLife));
          float second=smoothstep(.36,.44,r)*(1.-smoothstep(.48,.56,r))*smoothstep(0.,.08,vLife);
          float fade=1.-smoothstep(.06,.65,vLife);
          gl_FragColor=vec4(.46,.61,.68,(ring+second*.25+landing*.65)*fade*uFade*.32);
          #include <colorspace_fragment>
        }`,
    });
    const ripples = new THREE.Mesh(rippleGeometry, this.ripples);
    ripples.frustumCulled = false; ripples.raycast = () => {}; this.group.add(ripples);
    const seatGeometry = new THREE.CylinderGeometry(.52, .65, .22, 7);
    this.seat = new THREE.MeshBasicMaterial({ color: "#566169", transparent: true, opacity: 0 });
    const seat = new THREE.Mesh(seatGeometry, this.seat);
    seat.position.y = .11; seat.raycast = () => {};
    this.group.add(seat);
    this.materials.push(this.drops, this.patch, this.ripples, this.seat);
    this.geometries.push(geometry, patchGeometry, rippleGeometry, seatGeometry);
    this.group.visible = false;
  }

  /** Called from an explicit sound button or XR-entry gesture, never from a model. */
  async enableSound(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      if (!this.sound) {
        const ctx = new AudioContext();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
        const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 2400; band.Q.value = .6;
        const low = ctx.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 6000;
        const gain = ctx.createGain(); gain.gain.value = 0;
        source.connect(band).connect(low).connect(gain).connect(ctx.destination);
        source.start(); this.sound = { ctx, source, gain, filters: [band, low] };
      }
      await this.sound.ctx.resume(); this.soundEnabled = !this.disposed && this.sound.ctx.state === "running";
      return this.soundEnabled;
    } catch { return false; }
  }
  mute(): void { this.soundEnabled = false; this.lastSoundLevel = 0; this.sound?.gain.gain.setTargetAtTime(0, this.sound.ctx.currentTime, .5); }

  update(target: number, delta: number, reducedMotion = false): void {
    this.opacity = easeSky(this.opacity, target, delta);
    if (!reducedMotion) this.time += Math.min(delta, .1);
    this.group.visible = this.opacity > .001;
    this.drops.uniforms.uTime.value = this.time;
    this.patch.uniforms.uTime.value = this.time;
    this.ripples.uniforms.uTime.value = this.time;
    this.drops.uniforms.uFade.value = this.opacity;
    this.patch.uniforms.uFade.value = this.opacity;
    this.ripples.uniforms.uFade.value = this.opacity;
    this.seat.opacity = this.opacity;
    // One viewer's local sound; approach and departure follow the same fade.
    const level = this.soundEnabled && !document.hidden ? this.opacity * .055 : 0;
    if (this.sound && (Math.abs(level - this.lastSoundLevel) > .0005 || level === 0 && this.lastSoundLevel !== 0)) {
      this.sound.gain.gain.setTargetAtTime(level, this.sound.ctx.currentTime, .5); this.lastSoundLevel = level;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    if (this.sound) {
      this.sound.source.stop(); this.sound.source.disconnect(); this.sound.gain.disconnect();
      for (const filter of this.sound.filters) filter.disconnect();
      void this.sound.ctx.close(); this.sound = null;
    }
    this.group.removeFromParent();
  }
}
