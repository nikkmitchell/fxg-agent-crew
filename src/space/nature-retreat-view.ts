import * as THREE from "three";
import { easeSky } from "../../shared/earth-sky";
import { NATURE_COUNTS, natureRandom, natureSeeds, type NatureKind } from "../../shared/nature-retreat";
import { RainAudio } from "./rain-audio";
import workletURL from "./nature-audio-worklet.ts?worker&url";

const FADE = `uniform float uFade;`;
const COLORSPACE = `\n#include <colorspace_fragment>\n`;

/** Two independent placeable pieces. Only uniforms change per frame. */
export class NatureRetreatView {
  readonly group = new THREE.Group();
  private opacity = 0;
  private time = 0;
  private disposed = false;
  private readonly materials: THREE.ShaderMaterial[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly sound: RainAudio;
  constructor(readonly kind: NatureKind, at: { x: number; z: number }) {
    this.group.position.set(at.x, 0, at.z);
    this.sound = new RainAudio({ url: workletURL, name: "nature-texture", mode: kind, level: kind === "sakura" ? .07 : .055 });
    this.ground();
    if (kind === "sakura") this.sakura(); else this.fireflies();
    this.group.visible = false;
  }
  private add(geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial) {
    material.uniforms.uFade = { value: 0 };
    material.uniforms.uTime ??= { value: 0 };
    material.uniforms.uReduced ??= { value: 0 };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; mesh.raycast = () => {};
    this.group.add(mesh); this.geometries.push(geometry); this.materials.push(material);
    return mesh;
  }
  private ground() {
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(this.kind === "sakura" ? "#25212a" : "#10201d") } },
      vertexShader: `varying vec2 vAt; void main(){vAt=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec2 vAt; uniform vec3 uColor; ${FADE}
        void main(){float edge=1.-smoothstep(1.5,2.85,length(vAt)); gl_FragColor=vec4(uColor,edge*uFade); ${COLORSPACE} }`,
    });
    const mesh = this.add(new THREE.CircleGeometry(2.85, 48), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .005;
  }
  private seeds(count: number) {
    const geometry = new THREE.InstancedBufferGeometry(), plane = new THREE.PlaneGeometry(1, 1);
    geometry.index = plane.index!.clone();
    for (const [name, attribute] of Object.entries(plane.attributes)) geometry.setAttribute(name, attribute.clone());
    plane.dispose();
    const starts = new Float32Array(count * 3), motions = new Float32Array(count * 4);
    natureSeeds(this.kind, count).forEach((seed, i) => {
      starts.set([seed.x, seed.y, seed.z], i * 3);
      motions.set([seed.phase, seed.speed, seed.size, seed.tint], i * 4);
    });
    geometry.setAttribute("start", new THREE.InstancedBufferAttribute(starts, 3));
    geometry.setAttribute("motion", new THREE.InstancedBufferAttribute(motions, 4));
    geometry.instanceCount = count;
    return geometry;
  }
  private sakura() {
    // A slender asymmetric bough, not a heavy full-tree model.
    const parts: THREE.BufferGeometry[] = [];
    const branch = (a: number[], b: number[], r1: number, r2: number) => {
      const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
      const geometry = new THREE.CylinderGeometry(r2, r1, direction.length(), 7);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      geometry.translate(...from.add(to).multiplyScalar(.5).toArray()); parts.push(geometry);
    };
    branch([-1.85, 0, -.65], [-1.7, 1.6, -.65], .09, .052);
    branch([-1.7, 1.6, -.65], [-1.05, 2.65, -.8], .052, .027);
    branch([-1.05, 2.65, -.8], [-.1, 3.10, -.55], .027, .013);
    branch([-.1, 3.10, -.55], [.95, 3.25, -.85], .013, .003);
    branch([-1.6, 1.83, -.65], [-1.8, 2.65, -.1], .027, .003);
    branch([-1.05, 2.65, -.8], [-.28, 2.82, -1.48], .025, .003);
    branch([-.28, 2.82, -1.48], [.65, 2.73, -1.4], .013, .002);
    const positions: number[] = [], normals: number[] = [];
    for (const part of parts) {
      const plain = part.toNonIndexed();
      for (const [name, target] of [["position", positions], ["normal", normals]] as const) {
        const attr = plain.getAttribute(name);
        for (let i = 0; i < attr.count; i++) target.push(attr.getX(i), attr.getY(i), attr.getZ(i));
      }
      plain.dispose(); part.dispose();
    }
    const wood = new THREE.BufferGeometry();
    wood.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    wood.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    this.add(wood, new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vNormal;void main(){vNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying vec3 vNormal; ${FADE} void main(){float light=.6+.4*max(vNormal.y,0.);
        gl_FragColor=vec4(vec3(.042,.030,.032)*light,uFade); ${COLORSPACE} }`,
    }));
    const blossom = this.seeds(NATURE_COUNTS.blossoms), starts = blossom.getAttribute("start") as THREE.InstancedBufferAttribute;
    const random = natureRandom(0x626c6f6d);
    const clusters = [[-1.75, 2.58, -.09], [-1.12, 2.84, -.76], [-.12, 3.14, -.55], [.82, 3.26, -.85], [.50, 2.8, -1.4], [-.35, 2.88, -1.35]];
    for (let i = 0; i < starts.count; i++) {
      const center = clusters[i % clusters.length];
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * .47;
      starts.setXYZ(i, center[0] + Math.cos(angle) * radius, center[1] + (random() - .5) * .37, center[2] + Math.sin(angle) * radius * .6);
    }
    this.add(blossom, this.blossomMaterial());
    this.add(this.seeds(NATURE_COUNTS.petals), this.petalMaterial(false));
    const fallen = this.seeds(NATURE_COUNTS.fallen);
    const floor = fallen.getAttribute("start") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < floor.count; i++) floor.setY(i, .014);
    this.add(fallen, this.petalMaterial(true));
  }
  private blossomMaterial() {
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `attribute vec3 start;attribute vec4 motion;uniform float uTime;uniform float uReduced;varying vec2 vUv;varying float vTint;
        void main(){vUv=uv;vTint=motion.w;vec3 at=start;
          at.x+=sin(uTime*.18+start.x*2.)*.012;
          vec2 p=mat2(cos(motion.x*6.28),-sin(motion.x*6.28),sin(motion.x*6.28),cos(motion.x*6.28))*position.xy;
          vec4 view=modelViewMatrix*vec4(at,1.);view.xy+=p*.072*motion.z;
          gl_Position=projectionMatrix*view;}`,
      fragmentShader: `varying vec2 vUv;varying float vTint;${FADE}
        void main(){vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x), r=length(p);
          float edge=.70+.12*cos(a*5.);float alpha=1.-smoothstep(edge-.09,edge,r);
          vec3 color=mix(vec3(.30,.12,.16),vec3(.63,.36,.40),vTint);
          color=mix(vec3(.50,.30,.20),color,smoothstep(.04,.23,r));
          gl_FragColor=vec4(color,alpha*uFade*.9);${COLORSPACE}}`,
    });
  }
  private petalMaterial(fallen: boolean) {
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uFallen: { value: Number(fallen) } },
      vertexShader: `attribute vec3 start;attribute vec4 motion;uniform float uTime;uniform float uFallen;uniform float uReduced;
        varying vec2 vUv;varying float vTint;varying float vLife;
        float hash(float x){return fract(sin(x*127.1)*43758.5453);}
        void main(){vUv=uv;vTint=motion.w;float t=uTime,fall=t*.035*motion.y+motion.x;
          float cycle=floor(fall),phase=fract(fall);vec3 at=start;
          float change=hash(cycle+motion.x*191.);
          at.y=mix(3.65*(1.-phase)-.08,start.y,uFallen);
          at.x+=(sin(t*.22*motion.y+motion.x*31.)*.22+(change-.5)*.45)*(1.-uFallen);
          at.z+=cos(t*.17*motion.y+motion.x*17.)*.16*(1.-uFallen);
          float angle=motion.x*6.28+t*.20*motion.y*(1.-uFallen),c=cos(angle),s=sin(angle);
          vec2 p=mat2(c,-s,s,c)*position.xy*.052*motion.z;
          float yaw=t*.15*motion.y+motion.x*6.28;
          vec3 petal=vec3(p.x*cos(yaw),p.y,p.x*sin(yaw));
          if(uFallen>.5)petal=vec3(p.x,.002,p.y);
          vLife=uFallen>.5?1.:smoothstep(0.,.15,at.y)*(1.-smoothstep(3.35,3.65,at.y));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(at+petal,1.);}`,
      fragmentShader: `varying vec2 vUv;varying float vTint;varying float vLife;${FADE}
        void main(){vec2 p=(vUv-.5)*2.;float body=length(p*vec2(.85,1.2));
          float alpha=1.-smoothstep(.75,.89,body);float notch=1.-smoothstep(.07,.18,abs(p.x))*smoothstep(.5,.8,p.y);
          vec3 color=mix(vec3(.46,.22,.28),vec3(.80,.53,.57),vTint);
          gl_FragColor=vec4(color,alpha*(1.-notch*.7)*vLife*uFade*.85);${COLORSPACE}}`,
    });
  }
  private fireflies() {
    this.add(this.seeds(NATURE_COUNTS.fireflies), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `attribute vec3 start;attribute vec4 motion;uniform float uTime;uniform float uReduced;
        varying vec2 vUv;varying float vGlow;varying float vTint;
        void main(){vUv=uv;vTint=motion.w;float t=uTime,p=motion.x*41.;
          vec3 at=start+vec3(sin(t*.17*motion.y+p)*.27+sin(t*.43+p*.6)*.055,
            sin(t*.21*motion.y+p*1.3)*.15,cos(t*.14*motion.y+p)*.24+sin(t*.37+p)*.04);
          float cycle=t*(.12+motion.w*.12)+motion.x+sin(t*.037+p)*.07,phase=fract(cycle);
          float pulse=smoothstep(.03,.27,phase)*(1.-smoothstep(.33,.64,phase));
          float strength=.62+.38*fract(sin(floor(cycle)*127.1+motion.x*311.7)*43758.5453);
          vGlow=.035+pulse*.965*strength;
          vec4 view=modelViewMatrix*vec4(at,1.);view.xy+=position.xy*.12*motion.z;
          gl_Position=projectionMatrix*view;}`,
      fragmentShader: `varying vec2 vUv;varying float vGlow;varying float vTint;${FADE}
        void main(){float r=length((vUv-.5)*2.);
          float halo=exp(-r*r*7.)*.12,core=exp(-r*r*180.)*.95;
          vec3 color=mix(vec3(.51,.75,.16),vec3(.88,.72,.25),vTint);
          gl_FragColor=vec4(color,(halo+core)*vGlow*uFade);${COLORSPACE}}`,
    }));
    const random = natureRandom(0x72656564), vertices: number[] = [];
    // Five uneven pockets of grass frame empty standing space. No per-blade motion.
    for (const [x, z, count] of [[-1.8, -.7, 16], [.9, -1.7, 12], [1.7, .2, 8], [-.6, 1.7, 7], [-1.2, -1.8, 9]]) {
      for (let i = 0; i < count; i++) {
        const bx = x + (random() - .5) * .28, bz = z + (random() - .5) * .28;
        const height = .13 + random() * .27, lean = (random() - .5) * .16, width = .006 + random() * .006;
        vertices.push(bx-width,.012,bz,bx+width,.012,bz,bx+lean,height*.63,bz+.015);
        vertices.push(bx+width,.012,bz,bx+lean,height*.63,bz+.015,bx+lean*1.8,height,bz+.035);
      }
    }
    const grass = new THREE.BufferGeometry(); grass.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    this.add(grass, new THREE.ShaderMaterial({ transparent: true, side: THREE.DoubleSide,
      vertexShader: `varying float vHeight;void main(){vHeight=position.y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: `varying float vHeight;${FADE}void main(){vec3 color=mix(vec3(.009,.020,.014),vec3(.032,.051,.024),vHeight*2.);
        gl_FragColor=vec4(color,uFade);${COLORSPACE}}`,
    }));
  }
  enableSound() { return this.disposed ? Promise.resolve(false) : this.sound.enable(); }
  mute() { this.sound.mute(); }
  update(target: number, delta: number, reducedMotion = false) {
    this.opacity = easeSky(this.opacity, target, delta);
    if (!reducedMotion) this.time += Math.min(delta, .1);
    this.group.visible = this.opacity > .001;
    for (const material of this.materials) {
      material.uniforms.uFade.value = this.opacity; material.uniforms.uTime.value = this.time;
      material.uniforms.uReduced.value = Number(reducedMotion);
    }
    this.sound.update(this.opacity);
  }
  dispose() {
    this.disposed = true; this.sound.dispose(); this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
