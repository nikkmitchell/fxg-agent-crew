import * as THREE from "three";
import { easeSky } from "../../shared/sky-easing";
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
  private petalTime = 0;
  private emitting = false;
  private emissionStart = 1e6;
  private emissionEnd = -1;
  private previousStart = 1e6;
  private previousEnd = -1;
  private lightReveal = 0;
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
    const blossom = this.seeds(NATURE_COUNTS.blossoms);
    const starts = blossom.getAttribute("start") as THREE.InstancedBufferAttribute;
    const random = natureRandom(0x626c6f6d);
    // A circular ceiling of blossoms. No trunk, branches or imported model.
    for (let i = 0; i < starts.count; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 2.4;
      const height = 2.85 + .24 * (1. - radius / 2.4) + (random() - .5) * .36;
      starts.setXYZ(i, Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    }
    this.add(blossom, this.blossomMaterial());
    const petals = this.seeds(NATURE_COUNTS.petals);
    const origins = petals.getAttribute("start") as THREE.InstancedBufferAttribute;
    for (let i = 0; i < origins.count; i++) {
      const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * 2.15;
      origins.setXYZ(i, Math.cos(angle) * radius, 2.7 + random() * .45, Math.sin(angle) * radius);
    }
    this.add(petals, this.petalMaterial());
  }
  private blossomMaterial() {
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `attribute vec3 start;attribute vec4 motion;uniform float uTime;uniform float uReduced;varying vec2 vUv;varying float vTint;
        void main(){vUv=uv;vTint=motion.w;vec3 at=start;
          at.x+=sin(uTime*.18+start.x*2.)*.012;
          vec2 p=mat2(cos(motion.x*6.28),-sin(motion.x*6.28),sin(motion.x*6.28),cos(motion.x*6.28))*position.xy;
          vec4 view=modelViewMatrix*vec4(at,1.);view.xy+=p*.18*motion.z;
          gl_Position=projectionMatrix*view;}`,
      fragmentShader: `varying vec2 vUv;varying float vTint;${FADE}
        void main(){vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x), r=length(p);
          float edge=.70+.12*cos(a*5.);float alpha=1.-smoothstep(edge-.09,edge,r);
          vec3 color=mix(vec3(.30,.12,.16),vec3(.63,.36,.40),vTint);
          color=mix(vec3(.50,.30,.20),color,smoothstep(.04,.23,r));
          gl_FragColor=vec4(color,alpha*uFade*.9);${COLORSPACE}}`,
    });
  }
  private petalMaterial() {
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      uniforms: { uPetalTime: { value: 0 }, uEmissionStart: { value: 1e6 }, uEmissionEnd: { value: -1 },
        uPreviousStart: { value: 1e6 }, uPreviousEnd: { value: -1 } },
      vertexShader: `attribute vec3 start;attribute vec4 motion;uniform float uPetalTime;
        uniform float uEmissionStart;uniform float uEmissionEnd;uniform float uPreviousStart;uniform float uPreviousEnd;
        varying vec2 vUv;varying float vTint;varying float vLife;
        float hash(float x){return fract(sin(x*127.1)*43758.5453);}
        float wind(float t,float seed){float k=floor(t),f=fract(t);f=f*f*(3.-2.*f);return mix(hash(k+seed),hash(k+1.+seed),f)*2.-1.;}
        void main(){vUv=uv;vTint=motion.w;
          float fallTime=6.5+motion.y*1.8,restTime=4.+motion.w*2.5;
          float cycleTime=fallTime+restTime+2.+motion.x*3.;
          float elapsed=uPetalTime-motion.x*8.;float cycle=floor(elapsed/cycleTime);
          float born=cycle*cycleTime+motion.x*8.,age=elapsed-cycle*cycleTime;
          float released=step(0.,cycle)*max(step(uEmissionStart,born)*step(born,uEmissionEnd),
            step(uPreviousStart,born)*step(born,uPreviousEnd));
          float progress=clamp(age/fallTime,0.,1.),air=1.-smoothstep(.92,1.,progress);
          float phase=motion.x*31.+cycle*2.13;
          vec3 at=start;
          float flutterAge=min(age,fallTime),flightClock=born+flutterAge;
          vec2 gust=vec2(wind(flightClock*.19,3.7),wind(flightClock*.13,17.3));
          vec2 swing=vec2(sin(flutterAge*(1.7+motion.w)+phase),cos(flutterAge*(1.25+motion.x)+phase*1.3));
          at.xz+=progress*(gust*(.38+motion.w*.18)+swing*(.16+motion.x*.13))
            +vec2(hash(cycle+phase),hash(cycle+phase+17.))*.24-.12;
          at.y=max(.017,start.y*(1.-progress)+sin(age*4.3+phase)*.024*air);
          float roll=phase+sin(flutterAge*2.8+phase)*.85+flutterAge*.35;
          float yaw=phase+flutterAge*(2.3+motion.w*1.6)+gust.x*.6;
          vec2 p=mat2(cos(roll),-sin(roll),sin(roll),cos(roll))*position.xy*.065*motion.z;
          vec3 flying=vec3(p.x*cos(yaw),p.y,p.x*sin(yaw));
          vec3 resting=vec3(p.x,.002,p.y);
          vec3 petal=mix(resting,flying,air);
          float birth=smoothstep(0.,.45,age),landing=1.-smoothstep(.5,restTime,age-fallTime);
          vLife=released*birth*landing;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(at+petal,1.);}`,
      fragmentShader: `varying vec2 vUv;varying float vTint;varying float vLife;${FADE}
        void main(){vec2 p=(vUv-.5)*2.;float body=length(p*vec2(.85,1.2));
          float alpha=1.-smoothstep(.75,.89,body);float notch=1.-smoothstep(.07,.18,abs(p.x))*smoothstep(.5,.8,p.y);
          vec3 color=mix(vec3(.46,.22,.28),vec3(.80,.53,.57),vTint);
          gl_FragColor=vec4(color,alpha*(1.-notch*.7)*vLife*uFade*.85);${COLORSPACE}}`,
    });
  }
  private fireflies() {
    const lights = this.seeds(NATURE_COUNTS.fireflies);
    const guide = new Float32Array(NATURE_COUNTS.fireflies); guide[0] = 1;
    lights.setAttribute("guide", new THREE.InstancedBufferAttribute(guide, 1));
    (lights.getAttribute("start") as THREE.InstancedBufferAttribute).setXYZ(0, .24, 1.35, .12);
    this.add(lights, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: { uNear: { value: 0 } },
      vertexShader: `attribute vec3 start;attribute vec4 motion;attribute float guide;uniform float uTime;uniform float uReduced;uniform float uNear;
        varying vec2 vUv;varying float vGlow;varying float vTint;varying float vReveal;
        void main(){vUv=uv;vTint=motion.w;float t=uTime,p=motion.x*41.;
          vec3 at=start+vec3(sin(t*.17*motion.y+p)*.27+sin(t*.43+p*.6)*.055,
            sin(t*.21*motion.y+p*1.3)*.15,cos(t*.14*motion.y+p)*.24+sin(t*.37+p)*.04);
          float cycle=t*(.12+motion.w*.12)+motion.x+sin(t*.037+p)*.07,phase=fract(cycle);
          float pulse=smoothstep(.03,.27,phase)*(1.-smoothstep(.33,.64,phase));
          float strength=.62+.38*fract(sin(floor(cycle)*127.1+motion.x*311.7)*43758.5453);
          vGlow=mix(.035,.24,guide)+pulse*.85*strength;
          vReveal=mix(uNear,1.,guide);
          vec4 view=modelViewMatrix*vec4(at,1.);view.xy+=position.xy*.12*motion.z*(1.+guide*.6);
          gl_Position=projectionMatrix*view;}`,
      fragmentShader: `varying vec2 vUv;varying float vGlow;varying float vTint;varying float vReveal;${FADE}
        void main(){float r=length((vUv-.5)*2.);
          float halo=exp(-r*r*7.)*.12,core=exp(-r*r*180.)*.95;
          vec3 color=mix(vec3(.51,.75,.16),vec3(.88,.72,.25),vTint);
          gl_FragColor=vec4(color,(halo+core)*vGlow*vReveal);${COLORSPACE}}`,
    }));
    const random = natureRandom(0x72656564), vertices: number[] = [], kinds: number[] = [];
    // Sparse at the edge, progressively denser inside; unequal low/high patches.
    for (let i = 0; i < 440; i++) {
        const angle = random() * Math.PI * 2, radius = 2.65 * Math.pow(random(), .82);
        const bx = Math.cos(angle) * radius, bz = Math.sin(angle) * radius;
        const patch = .5 + .25 * Math.sin(bx * 3.1 + bz * 1.8) + .25 * Math.sin(bz * 4.7 - bx * 2.3);
        const height = (.05 + patch * .24) * (.65 + random() * .65), lean = (random() - .5) * .17, width = .006 + random() * .007;
        vertices.push(bx-width,.012,bz,bx+width,.012,bz,bx+lean,height*.63,bz+.015);
        vertices.push(bx+width,.012,bz,bx+lean,height*.63,bz+.015,bx+lean*1.8,height,bz+.035);
        kinds.push(0,0,0,0,0,0);
    }
    for (const [x,z,size] of [[.9,-.6,.12],[-.4,.8,.085],[-1.1,-1.3,.095]]) {
      const stone = new THREE.IcosahedronGeometry(size,0);
      const positions = stone.getAttribute("position");
      for(let i=0;i<positions.count;i++) {
        vertices.push(x+positions.getX(i)*1.3,.04+positions.getY(i)*.5,z+positions.getZ(i)); kinds.push(1);
      }
      stone.dispose();
    }
    const grass = new THREE.BufferGeometry(); grass.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    grass.setAttribute("kind", new THREE.Float32BufferAttribute(kinds, 1)); grass.computeVertexNormals();
    this.add(grass, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `attribute float kind;uniform float uTime;varying float vKind;varying vec3 vNormal;varying float vHeight;void main(){vKind=kind;vNormal=normal;vHeight=position.y;vec3 at=position;at.x+=sin(uTime*.42+position.z*4.)*.009*position.y/.35*(1.-kind);gl_Position=projectionMatrix*modelViewMatrix*vec4(at,1.);}`,
      fragmentShader: `varying float vKind;varying vec3 vNormal;varying float vHeight;${FADE}void main(){vec3 color=mix(vec3(.009,.020,.014),vec3(.032,.051,.024),vHeight*2.);
        if(vKind>.5)color=vec3(.023,.029,.03)*(.55+.45*max(vNormal.y,0.));
        gl_FragColor=vec4(color,uFade);${COLORSPACE}}`,
    }));
  }
  enableSound() { return this.disposed ? Promise.resolve(false) : this.sound.enable(); }
  mute() { this.sound.mute(); }
  update(target: number, delta: number, reducedMotion = false) {
    this.opacity = easeSky(this.opacity, target, delta);
    if (!reducedMotion) this.time += Math.min(delta, .1);
    this.group.visible = this.opacity > .001 || this.kind === "fireflies";
    if (this.kind === "fireflies") this.lightReveal = easeSky(this.lightReveal, Math.max(0, Math.min(1, (target - .8) / .2)), delta);
    if (this.kind === "sakura") {
      if (!reducedMotion) this.petalTime += Math.min(delta, .1);
      const beneath = target >= .85 && !reducedMotion;
      if (beneath && !this.emitting) {
        this.previousStart = this.emissionStart; this.previousEnd = this.emissionEnd;
        this.emissionStart = this.petalTime;
      }
      if (beneath) this.emissionEnd = this.petalTime;
      this.emitting = beneath;
    }
    for (const material of this.materials) {
      material.uniforms.uFade.value = this.opacity; material.uniforms.uTime.value = this.time;
      material.uniforms.uReduced.value = Number(reducedMotion);
      if (material.uniforms.uNear) material.uniforms.uNear.value = this.lightReveal;
      if (material.uniforms.uPetalTime) {
        material.uniforms.uPetalTime.value = this.petalTime;
        material.uniforms.uEmissionStart.value = this.emissionStart;
        material.uniforms.uEmissionEnd.value = this.emissionEnd;
        material.uniforms.uPreviousStart.value = this.previousStart;
        material.uniforms.uPreviousEnd.value = this.previousEnd;
      }
    }
    this.sound.update(this.opacity);
  }
  dispose() {
    this.disposed = true; this.sound.dispose(); this.group.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
