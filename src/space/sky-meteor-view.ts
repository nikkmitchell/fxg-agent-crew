import * as THREE from "three";
import { meteorOpacity, meteorSpec, nextMeteorDelay, type MeteorSpec } from "../../shared/sky-meteors";

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
    const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
    const uv = new Float32Array((SEGMENTS + 1) * 2 * 2);
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      uv.set([i / SEGMENTS, 0, i / SEGMENTS, 1], i * 4);
      if (i < SEGMENTS) { const p = i * 2; indices.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geometry.setIndex(indices);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: { uAlpha: { value: 0 }, uIntensity: { value: spec.strength }, uColor: { value: new THREE.Color(spec.bolide ? "#f4e2c0" : "#d6e4f5") } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float uAlpha; uniform float uIntensity; uniform vec3 uColor;
        void main(){ float edge=1.-smoothstep(.1,1.,abs(vUv.y-.5)*2.);
        float head=exp(-vUv.x*45.);
        gl_FragColor=vec4(uColor*uIntensity*(.6+head*1.7),uAlpha*pow(1.-vUv.x,1.4)*edge);
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
      if (streak.age >= streak.spec.duration + streak.spec.linger) { this.remove(n); continue; }
      const fraction = Math.min(1, streak.age / streak.spec.duration);
      const angle = THREE.MathUtils.degToRad(streak.spec.sweep * fraction);
      const tail = THREE.MathUtils.degToRad(streak.spec.trail);
      const width = THREE.MathUtils.degToRad(streak.spec.width);
      const position = streak.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i <= SEGMENTS; i++) {
        const along = angle - tail * i / SEGMENTS;
        this.direction.copy(streak.start).multiplyScalar(Math.cos(along)).addScaledVector(streak.tangent, Math.sin(along));
        this.cross.copy(streak.start).cross(streak.tangent).normalize();
        const pathFraction = Math.max(0, Math.min(1, along / THREE.MathUtils.degToRad(streak.spec.sweep)));
        this.direction.addScaledVector(this.cross, Math.sin(pathFraction * Math.PI) * THREE.MathUtils.degToRad(streak.spec.curve)).normalize();
        const headWidth = 1 + 2.5 * Math.exp(-i / SEGMENTS * 35);
        for (let side = 0; side < 2; side++) {
          this.offset.copy(this.direction).multiplyScalar(RADIUS).addScaledVector(this.cross, RADIUS * width * headWidth * (side - .5));
          position.setXYZ(i * 2 + side, this.offset.x, this.offset.y, this.offset.z);
        }
      }
      position.needsUpdate = true;
      streak.mesh.material.uniforms.uAlpha.value = visibility * meteorOpacity(streak.age, streak.spec.duration, streak.spec.linger);
    }
  }
  private remove(index: number): void {
    const { mesh } = this.streaks[index]; mesh.removeFromParent(); mesh.geometry.dispose(); mesh.material.dispose(); this.streaks.splice(index, 1);
  }
  private clear(): void { while (this.streaks.length) this.remove(this.streaks.length - 1); }
  dispose(): void { this.clear(); this.group.removeFromParent(); }
}
