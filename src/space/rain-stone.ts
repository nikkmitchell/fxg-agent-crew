import * as THREE from "three";

/** Slab, pebbles, moss cushions and grass share one small procedural draw. */
export function createRainStone() { return createStonePiece(false); }
export function createRainApproach() { return createStonePiece(true); }
function createStonePiece(approach: boolean) {
  const positions: number[] = [], kinds: number[] = [];
  const point = (x: number, y: number, z: number, kind: number) => { positions.push(x, y, z); kinds.push(kind); };
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: number) => {
    for (const p of [a, b, c]) point(p.x, p.y, p.z, kind);
  };
  const irregular = [1, .88, 1.06, .82, .97, 1.04, .91, 1.02, .79, 1.07, .86, .99];
  const slab = (x: number, z: number, radius: number, height: number, rotation: number, part: number) => {
    const rings = [[1, .012], [1.01, height * .61], [.87, height]];
    const vertices = rings.map(([scale, y]) => irregular.map((w, i) => {
      const angle = rotation + i / irregular.length * Math.PI * 2;
      return new THREE.Vector3(x + Math.cos(angle) * radius * w * scale, y,
        z + Math.sin(angle) * radius * w * scale * .9);
    }));
    for (let i = 0; i < irregular.length; i++) {
      const next = (i + 1) % irregular.length;
      // Counterclockwise from above: all of the sitting surface is one plane.
      triangle(new THREE.Vector3(x, height, z), vertices[2][next], vertices[2][i], part);
      for (let ring = 0; ring < 2; ring++) {
        triangle(vertices[ring][i], vertices[ring + 1][i], vertices[ring][next], part);
        triangle(vertices[ring][next], vertices[ring + 1][i], vertices[ring + 1][next], part);
      }
    }
  };
  if (approach) {
    slab(-.17, 2.05, .28, .055, .63, 1);
    slab(.23, 2.9, .35, .075, -.39, 1);
    slab(-.22, 3.9, .25, .045, 1.14, 1);
    slab(.12, 4.8, .3, .065, -.74, 1);
  } else {
    slab(0, 0, .64, .245, .17, 0);
    slab(-.68, -.12, .15, .105, .62, 1);
    slab(.59, .35, .14, .08, -.4, 1);
    slab(-.16, -.63, .15, .13, .9, 1);
  }

  if (!approach) {
    // Thin, soft moss cushions; the broad center remains a flat sitting surface.
    for (const [x, z, radius] of [[-.18, -.16, .30], [.20, -.19, .19]]) {
      const center = new THREE.Vector3(x, .258, z);
      for (let i = 0; i < irregular.length; i++) {
        const a = i / irregular.length * Math.PI * 2, b = (i + 1) / irregular.length * Math.PI * 2;
        triangle(center,
          new THREE.Vector3(x + Math.cos(b) * radius * irregular[(i + 1) % irregular.length], .247, z + Math.sin(b) * radius * .8),
          new THREE.Vector3(x + Math.cos(a) * radius * irregular[i], .247, z + Math.sin(a) * radius * .8), 3);
      }
    }
  }
  const tufts = Array.from({ length: 10 }, (_, i) => {
    const angle = i / 10 * Math.PI * 2 + .12;
    return [Math.cos(angle) * .73, Math.sin(angle) * .73, 10, angle];
  }).filter((_, i) => i !== 2); // An open edge toward the stepping stones.
  // Fuller curved tufts around the base, with no animation or textures.
  for (const [x, z, count, rotation] of approach ? [] : tufts) {
    for (let i = 0; i < count; i++) {
      const angle = rotation + i * 2.4, height = .13 + (i % 5) * .028;
      const base = new THREE.Vector3(x + Math.cos(i * 4) * .035, .014, z + Math.sin(i * 4) * .035);
      const side = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const lean = new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(.035 + (i % 3) * .014);
      const left = base.clone().addScaledVector(side, -.011), right = base.clone().addScaledVector(side, .011);
      const middle = base.clone().addScaledVector(lean, .45).setY(height * .62);
      const tip = base.clone().add(lean).setY(height);
      triangle(left, right, middle.clone().addScaledVector(side, .004), 2);
      triangle(left, middle.clone().addScaledVector(side, .004), middle.clone().addScaledVector(side, -.004), 2);
      triangle(middle.clone().addScaledVector(side, -.004), middle.clone().addScaledVector(side, .004), tip, 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("kind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, uniforms: { uFade: { value: 0 } },
    vertexShader: `attribute float kind; varying vec3 vAt; varying vec3 vNormal; varying float vKind;
      void main(){vAt=position; vNormal=normal; vKind=kind;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vAt; varying vec3 vNormal; varying float vKind; uniform float uFade;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        float grain=noise(vAt.xz*48.)*.5+noise(vAt.xz*137.)*.5;
        float shade=.58+.42*max(0.,dot(normalize(vNormal),normalize(vec3(-.4,1.,.6))));
        vec3 color=mix(vec3(.036,.048,.052),vec3(.08,.10,.105),grain)*shade;
        if(vKind<.5){
          // A broken moss patch wraps one edge, leaving the main sitting area clear.
          float edge=1.-smoothstep(.25,.6,length((vAt.xz-vec2(-.16,-.22))*vec2(1.,1.2)));
          float texture=noise(vAt.xz*19.);
          float moss=edge*smoothstep(.12,.45,texture)*smoothstep(.08,.2,vAt.y);
          vec3 mossColor=mix(vec3(.028,.072,.023),vec3(.095,.16,.05),texture);
          color=mix(color,mossColor*shade,moss*.95);
        }
        if(vKind>1.5&&vKind<2.5) color=mix(vec3(.025,.06,.025),vec3(.085,.17,.048),clamp(vAt.y/.24,0.,1.));
        if(vKind>2.5){float soft=noise(vAt.xz*37.); color=mix(vec3(.03,.078,.024),vec3(.10,.175,.052),soft)*shade;}
        gl_FragColor=vec4(color,uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => {};
  return mesh;
}
