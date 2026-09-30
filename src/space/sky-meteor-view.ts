import * as THREE from "three";
import { METEOR_TRAIL_DECAY, meteorHeadGlow, meteorOpacity, meteorSpec, meteorTravel, nextMeteorDelay, type MeteorSpec } from "../../shared/sky-meteors";

type Streak = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>; start: THREE.Vector3; tangent: THREE.Vector3; spec: MeteorSpec; age: number };
const SEGMENTS = 24, RADIUS = 79;
/** Only active streaks draw. An exceptional bolide crosses the spawn-time field of view. */
export class SkyMeteorView {
  readonly group = new THREE.Group();
  private next = nextMeteorDelay(Math.random);
  private elapsed = 0;
  private readonly streaks: Streak[] = [];
  private readonly direction = new THREE.Vector3();
  private readonly cross = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly headAt = new THREE.Vector3();
  private readonly alongHead = new THREE.Vector3();

  preview(kind: "meteor" | "bolide", forward: THREE.Vector3): void { this.spawn(forward, kind); }
  private spawn(forward: THREE.Vector3, force?: "meteor" | "bolide"): void {
    if (this.streaks.length >= 2) return;
    const spec = meteorSpec(Math.random, force);
    const start = new THREE.Vector3();
    if (spec.bolide || force) start.copy(forward).normalize();
    else {
      const y = Math.random() * 2 - 1, angle = Math.random() * Math.PI * 2;
      start.set(Math.sqrt(1 - y * y) * Math.cos(angle), y, Math.sqrt(1 - y * y) * Math.sin(angle));
    }
    // Random orientation in the tangent plane, including sloping streaks.
    let axis = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).cross(start);
    if (axis.lengthSq() < .0001) axis = new THREE.Vector3(0, 1, 0).cross(start);
    if (axis.lengthSq() < .0001) axis.set(1, 0, 0);
    axis.normalize();
    if (spec.bolide || force) start.applyAxisAngle(axis, -THREE.MathUtils.degToRad(spec.sweep / 2));
    const tangent = axis.clone().cross(start).normalize();
    const headBase = (SEGMENTS + 1) * 2;
    const positions = new Float32Array((headBase + 4) * 3);
    const uv = new Float32Array((headBase + 4) * 2);
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      uv.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4);
      if (i < SEGMENTS) { const p = i * 2; indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
    // A tiny procedural glow quad shares the ribbon's one draw call.
    uv.set([2, 0, 3, 0, 2, 1, 3, 1], headBase * 2);
    indices.push(headBase, headBase + 1, headBase + 2, headBase + 1, headBase + 3, headBase + 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 0 }, uHead: { value: 1 }, uVisibility: { value: 0 }, uAge: { value: 0 },
        uLifetime: { value: spec.duration + spec.linger }, uPeakAt: { value: spec.peak },
        uTrailTime: { value: spec.trail / spec.sweep * (spec.duration + spec.linger) },
        uDecay: { value: METEOR_TRAIL_DECAY[spec.bolide ? "bolide" : "meteor"] },
        uPeak: { value: (spec.bolide ? 1 : .85) * spec.peakBoost }, uIntensity: { value: spec.strength / (spec.bolide ? 3.6 : 1.6) },
        uColor: { value: new THREE.Color(spec.bolide ? "#f4e2c0" : "#d6e4f5") } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float uAlpha; uniform float uIntensity; uniform vec3 uColor;
        uniform float uHead; uniform float uPeak; uniform float uVisibility;
        uniform float uAge; uniform float uLifetime; uniform float uTrailTime; uniform float uPeakAt; uniform float uDecay;
        float depositedLight(float at){
          float phase=at/uLifetime;
          if(phase<=0.||phase>=1.) return 0.;
          float t=phase<=uPeakAt?phase/uPeakAt:(1.-phase)/(1.-uPeakAt);
          float light=t*t*(3.-2.*t);
          return light*light;
        }
        void main(){
        if(vUv.x>=2.) {
          float r=length(vec2(vUv.x-2.5,vUv.y-.5))*2.;
          float glow=(exp(-r*r*7.)*.24+exp(-r*r*32.)*.76)*(1.-smoothstep(.75,1.,r));
          gl_FragColor=vec4(uColor,uAlpha*uHead*uIntensity*uPeak*glow);
        } else {
        float edge=1.-smoothstep(.1,1.,abs(vUv.y-.5)*2.);
        float head=exp(-vUv.x*45.);
        // Each point remembers the head's light when it passed, then rapidly
        // decays there. This is an afterimage, not a frozen bright head.
        float delay=vUv.x*uTrailTime;
        float trail=depositedLight(uAge-delay)*exp(-delay/uDecay)*.38;
        gl_FragColor=vec4(uColor,
          uIntensity*(uVisibility*trail+uAlpha*head*uHead*uPeak)*pow(1.-vUv.x,1.4)*edge);
        }
        #include <colorspace_fragment>
      }`,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -97; mesh.frustumCulled = false; mesh.raycast = () => {};
    this.group.add(mesh); this.streaks.push({ mesh, spec, start, tangent, age: 0 });
  }
  update(delta: number, visibility: number, forward: THREE.Vector3, reducedMotion: boolean): void {
    if (reducedMotion || visibility < .01) {
      this.clear(); this.elapsed = 0; this.next = nextMeteorDelay(Math.random); return;
    }
    this.elapsed += delta;
    if (this.elapsed >= this.next) {
      if (visibility > .95) this.spawn(forward);
      this.next = this.elapsed + nextMeteorDelay(Math.random);
    }
    for (let n = this.streaks.length - 1; n >= 0; n--) {
      const streak = this.streaks[n]; streak.age += delta;
      const decay = METEOR_TRAIL_DECAY[streak.spec.bolide ? "bolide" : "meteor"];
      if (streak.age >= streak.spec.duration + streak.spec.linger + decay * 3) { this.remove(n); continue; }
      // One moving flight spans the complete burn-out, including the fade.
      // Its head never reaches an endpoint and waits for a residual glow.
      const fraction = meteorTravel(streak.age, streak.spec.duration + streak.spec.linger);
      const headGlow = meteorHeadGlow(streak.age, streak.spec.duration, streak.spec.linger, streak.spec.peak);
      const angle = THREE.MathUtils.degToRad(streak.spec.sweep * fraction);
      const tail = THREE.MathUtils.degToRad(streak.spec.trail);
      const width = THREE.MathUtils.degToRad(streak.spec.width);
      const position = streak.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i <= SEGMENTS; i++) {
        const along = angle - tail * i / SEGMENTS;
        this.direction.copy(streak.start).multiplyScalar(Math.cos(along)).addScaledVector(streak.tangent, Math.sin(along));
        this.cross.copy(streak.start).cross(streak.tangent).normalize();
        const pathFraction = along / THREE.MathUtils.degToRad(streak.spec.sweep);
        this.direction.addScaledVector(this.cross, Math.sin(pathFraction * Math.PI) * THREE.MathUtils.degToRad(streak.spec.curve)).normalize();
        if (i === 0) this.headAt.copy(this.direction).multiplyScalar(RADIUS);
        const headWidth = 1 + headGlow * Math.exp(-i / SEGMENTS * 35);
        for (let side = 0; side < 2; side++) {
          this.offset.copy(this.direction).multiplyScalar(RADIUS).addScaledVector(this.cross, RADIUS * width * headWidth * (side - .5));
          position.setXYZ(i * 2 + side, this.offset.x, this.offset.y, this.offset.z);
        }
      }
      this.alongHead.copy(streak.start).multiplyScalar(-Math.sin(angle)).addScaledVector(streak.tangent, Math.cos(angle)).normalize();
      // Peak energy grows the luminous area, instead of clipping a tiny point
      // to white. The changing brightness remains legible on ordinary displays.
      const glowWidth = RADIUS * width * (streak.spec.bolide ? 45 : 14) * (.35 + .65 * headGlow / 1.8);
      for (let corner = 0; corner < 4; corner++) {
        this.offset.copy(this.headAt).addScaledVector(this.cross, glowWidth * ((corner % 2) - .5))
          .addScaledVector(this.alongHead, glowWidth * (Math.floor(corner / 2) - .5));
        position.setXYZ((SEGMENTS + 1) * 2 + corner, this.offset.x, this.offset.y, this.offset.z);
      }
      position.needsUpdate = true;
      streak.mesh.material.uniforms.uAlpha.value = visibility * meteorOpacity(streak.age, streak.spec.duration, streak.spec.linger, streak.spec.peak);
      // Avoid prolonged white clipping so the rise and fall remain visible.
      streak.mesh.material.uniforms.uHead.value = headGlow / 1.8;
      streak.mesh.material.uniforms.uAge.value = streak.age;
      streak.mesh.material.uniforms.uVisibility.value = visibility;
    }
  }
  private remove(index: number): void {
    const { mesh } = this.streaks[index]; mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); this.streaks.splice(index, 1);
  }
  private clear(): void { while (this.streaks.length) this.remove(this.streaks.length - 1); }
  dispose(): void { this.clear(); this.group.removeFromParent(); }
}
