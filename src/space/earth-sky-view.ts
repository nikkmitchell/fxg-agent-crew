import * as THREE from "three";
import type { EarthSkySnapshot } from "../../shared/earth-sky";
import { easeSky } from "../../shared/sky-easing";
import { SkyMeteorView } from "./sky-meteor-view";

const RADIUS = 80;
/** Three draw calls: backdrop, catalogue points, moon. No per-star frame work. */
export class EarthSkyView {
  readonly group = new THREE.Group();
  private opacity = 0;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly eye = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly starGeometry: THREE.BufferGeometry;
  private readonly moon: THREE.Mesh;
  private readonly moonMaterial: THREE.ShaderMaterial;
  private next: EarthSkySnapshot;
  private current: EarthSkySnapshot;
  private readonly direction = new THREE.Vector3();
  private readonly toward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly sun = new THREE.Vector3();
  private readonly endpoint = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private readonly meteors = new SkyMeteorView();
  private accentsTime = 0;

  constructor(readonly sky: EarthSkySnapshot) {
    this.current = sky;
    this.next = sky;
    const backdropGeometry = new THREE.SphereGeometry(RADIUS + 1, 32, 16);
    const backdropMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uFade: { value: 0 } },
      vertexShader: `void main() { gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uFade;
        void main() {
          gl_FragColor=vec4(.004,.007,.018,uFade);
          #include <colorspace_fragment>
        }`,
    });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.renderOrder = -100;
    backdrop.raycast = () => {};
    this.group.add(backdrop);

    const total = sky.stars.length + sky.planets.length;
    const positions = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const colors = new Float32Array(total * 3);
    const twinkle = new Float32Array(total * 3);
    const color = new THREE.Color();
    sky.stars.forEach((star, i) => {
      positions.set(star.direction.map((v) => v * RADIUS), i * 3);
      // Keep dim stars small; apparent catalogue magnitude sets size/brightness.
      sizes[i] = Math.max(1, 3.8 - star.magnitude * .4);
      color.set(star.colorIndex < .15 ? "#d0e2ff" : star.colorIndex > 1 ? "#ffdbb5" : "#f5f1e8");
      const brightness = Math.max(.14, Math.min(1, Math.pow(10, -.16 * (star.magnitude + 1.5))));
      colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
      // A gentle visual interpretation of atmospheric scintillation, rather
      // than switching stars off. Each has its own phase, rate and strength.
      const scatter = (Math.sin(star.id * 127.1) * 43758.5453) % 1;
      const variation = scatter - Math.floor(scatter);
      twinkle.set([(star.id * 2.399963) % (Math.PI * 2), 1.1 + variation * 1.6,
        .45 + ((star.id * .618034) % 1) * .55], i * 3);
    });
    sky.planets.forEach((planet, n) => {
      const i = sky.stars.length + n;
      positions.set(planet.direction.map((v) => v * RADIUS), i * 3);
      sizes[i] = Math.max(2.4, Math.min(5.2, 3.8 - planet.magnitude * .4));
      color.set(planet.color);
      const brightness = Math.max(.25, Math.min(1, Math.pow(10, -.16 * (planet.magnitude + 1.5))));
      colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
      // Planets are steady, unlike atmospheric star scintillation.
    });
    const starGeometry = new THREE.BufferGeometry();
    this.starGeometry = starGeometry;
    starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute("nextPosition", new THREE.BufferAttribute(positions.slice(), 3));
    starGeometry.setAttribute("pointSize", new THREE.BufferAttribute(sizes, 1));
    starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    starGeometry.setAttribute("twinkle", new THREE.BufferAttribute(twinkle, 3));
    this.starMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: { uFade: { value: 0 }, uResolution: { value: 1 }, uAdvance: { value: 0 }, uTime: { value: 0 }, uTwinkle: { value: .2 } },
      vertexShader: `attribute float pointSize; attribute vec3 color; attribute vec3 nextPosition; attribute vec3 twinkle;
        uniform float uResolution; uniform float uAdvance; uniform float uTime; uniform float uTwinkle; varying vec3 vColor;
        void main() {
          vec3 direction=normalize(mix(position,nextPosition,uAdvance));
          float shimmer=.55*sin(uTime*twinkle.y+twinkle.x)
            +.3*sin(uTime*twinkle.y*1.731+twinkle.x*2.41)
            +.15*sin(uTime*twinkle.y*.417+twinkle.x*3.13);
          float breathe=uTwinkle*twinkle.z*shimmer;
          vColor=color*(1.+breathe);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(direction*80.,1.);
          gl_PointSize=pointSize*uResolution*(1.+breathe*.08);
        }`,
      fragmentShader: `uniform float uFade; varying vec3 vColor;
        void main() {
          float radius=length(gl_PointCoord-vec2(.5))*2.;
          if(radius>1.) discard;
          float soft=1.-smoothstep(.12,1.,radius);
          gl_FragColor=vec4(vColor,uFade*soft);
          #include <colorspace_fragment>
        }`,
    });
    const points = new THREE.Points(starGeometry, this.starMaterial);
    points.renderOrder = -99;
    points.frustumCulled = false;
    points.raycast = () => {};
    points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(this.size);
      const view = camera as THREE.PerspectiveCamera & { viewport?: THREE.Vector4 };
      const height = view.viewport?.w ?? this.size.y;
      // Size follows angular field of view and per-eye render resolution.
      this.starMaterial.uniforms.uResolution.value = Math.max(.6, height / 900 * view.projectionMatrix.elements[5]);
    };
    this.group.add(points);

    const moonGeometry = new THREE.PlaneGeometry(1, 1);
    const direction = new THREE.Vector3(...sky.moon);
    const toward = direction.clone().negate();
    const right = new THREE.Vector3(0, 1, 0).cross(toward).normalize();
    if (right.lengthSq() < .001) right.set(1, 0, 0);
    const up = toward.clone().cross(right).normalize();
    const sun = new THREE.Vector3(...sky.sun);
    const moonMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, toneMapped: false,
      uniforms: { uFade: { value: 0 }, uLight: { value: new THREE.Vector3(sun.dot(right), sun.dot(up), sun.dot(toward)) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `varying vec2 vUv; uniform float uFade; uniform vec3 uLight;
        void main(){
          vec2 p=(vUv-.5)*2.; float r2=dot(p,p); if(r2>1.) discard;
          vec3 normal=vec3(p,sqrt(max(0.,1.-r2)));
          float lit=smoothstep(-.015,.04,dot(normal,uLight));
          // Restrained procedural surface, not a claimed lunar terrain map.
          float mare=.92+.04*sin(p.x*19.+sin(p.y*13.))+.035*sin(p.y*24.);
          vec3 color=mix(vec3(.018,.025,.039),vec3(.73,.72,.65)*mare,lit);
          gl_FragColor=vec4(color,uFade*(1.-smoothstep(.97,1.,sqrt(r2))));
          #include <colorspace_fragment>
        }`,
    });
    const moon = new THREE.Mesh(moonGeometry, moonMaterial);
    this.moon = moon;
    this.moonMaterial = moonMaterial;
    moon.position.copy(direction).multiplyScalar(RADIUS - .5);
    moon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, toward));
    // 1 degree for readability in a headset (~2x the real apparent diameter).
    moon.scale.setScalar(2 * (RADIUS - .5) * Math.tan(THREE.MathUtils.degToRad(.5)));
    moon.renderOrder = -98;
    moon.raycast = () => {};
    this.group.add(moon);
    this.group.add(this.meteors.group);
    this.materials.push(backdropMaterial, this.starMaterial, moonMaterial);
    this.geometries.push(backdropGeometry, starGeometry, moonGeometry);
    this.group.visible = false;
  }

  /** Refresh once per minute; the GPU interpolates the catalogue between these samples. */
  setInterval(current: EarthSkySnapshot, next: EarthSkySnapshot): void {
    if (current.stars.length !== this.sky.stars.length || next.stars.length !== this.sky.stars.length)
      throw new Error("Sky catalogue changed during a visit");
    this.current = current;
    this.next = next;
    // Date changes also change a planet's apparent magnitude. Keep its colour
    // and point size in the existing catalogue draw rather than creating nodes.
    const color = new THREE.Color();
    const sizes = this.starGeometry.getAttribute("pointSize") as THREE.BufferAttribute;
    const colors = this.starGeometry.getAttribute("color") as THREE.BufferAttribute;
    current.planets.forEach((planet, i) => {
      const at = current.stars.length + i;
      sizes.setX(at, Math.max(2.4, Math.min(5.2, 3.8 - planet.magnitude * .4)));
      color.set(planet.color);
      const light = Math.max(.25, Math.min(1, Math.pow(10, -.16 * (planet.magnitude + 1.5))));
      colors.setXYZ(at, color.r * light, color.g * light, color.b * light);
    });
    sizes.needsUpdate = true; colors.needsUpdate = true;
    for (const [key, snapshot] of [["position", current], ["nextPosition", next]] as const) {
      const attribute = this.starGeometry.getAttribute(key) as THREE.BufferAttribute;
      snapshot.stars.forEach((star, i) => attribute.setXYZ(i, ...star.direction.map((v) => v * RADIUS) as [number, number, number]));
      snapshot.planets.forEach((planet, i) => attribute.setXYZ(snapshot.stars.length + i, ...planet.direction.map((v) => v * RADIUS) as [number, number, number]));
      attribute.needsUpdate = true;
    }
  }

  update(eye: THREE.Vector3, target: number, delta: number, advance = 0, reducedMotion = false, forward?: THREE.Vector3): void {
    if (!reducedMotion) this.accentsTime += Math.min(delta, .1);
    this.starMaterial.uniforms.uTime.value = this.accentsTime;
    this.starMaterial.uniforms.uTwinkle.value = reducedMotion ? 0 : .2;
    const fraction = THREE.MathUtils.clamp(advance, 0, 1);
    this.starMaterial.uniforms.uAdvance.value = fraction;
    this.direction.set(...this.current.moon).lerp(this.endpoint.set(...this.next.moon), fraction).normalize();
    this.toward.copy(this.direction).negate();
    this.right.set(0, 1, 0).cross(this.toward).normalize();
    if (this.right.lengthSq() < .001) this.right.set(1, 0, 0);
    this.up.copy(this.toward).cross(this.right).normalize();
    this.sun.set(...this.current.sun).lerp(this.endpoint.set(...this.next.sun), fraction).normalize();
    this.moon.position.copy(this.direction).multiplyScalar(RADIUS - .5);
    this.moon.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right, this.up, this.toward));
    (this.moonMaterial.uniforms.uLight.value as THREE.Vector3).set(this.sun.dot(this.right), this.sun.dot(this.up), this.sun.dot(this.toward));
    this.opacity = easeSky(this.opacity, THREE.MathUtils.clamp(target, 0, 1), delta);
    // Camera-relative translation gives a distant sky with no head-motion parallax.
    this.eye.copy(eye);
    this.group.parent?.worldToLocal(this.eye);
    this.group.position.copy(this.eye);
    this.group.visible = this.opacity > .001;
    for (const material of this.materials) material.uniforms.uFade.value = this.opacity;
    this.meteors.update(Math.min(delta, .1), this.opacity, forward ?? this.direction, reducedMotion);
  }

  dispose(): void {
    this.meteors.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.removeFromParent();
  }

  /** Lets the local shell recede in exact sync with this viewer's sky fade. */
  get visibility(): number { return this.opacity; }
  /** Review-only trigger; production events use their own rare scheduler. */
  previewMeteor(kind: "meteor" | "bolide", forward: THREE.Vector3): void { this.meteors.preview(kind, forward); }
}
