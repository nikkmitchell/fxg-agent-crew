import * as THREE from "three";

/** A small woodland fragment: everything is merged into one procedural draw. */
export function createRainStone() { return createStonePiece(false); }
export function createRainApproach() { return createStonePiece(true); }
function createStonePiece(approach: boolean) {
  const positions: number[] = [], kinds: number[] = [], surfaces: number[] = [];
  const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: number,
    local?: THREE.Vector3[]) => {
    [a, b, c].forEach((p, i) => {
      positions.push(p.x, p.y, p.z); kinds.push(kind);
      const uv = local?.[i] ?? p; surfaces.push(uv.x, uv.y, uv.z);
    });
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
      triangle(new THREE.Vector3(x, height, z), vertices[2][next], vertices[2][i], part);
      for (let ring = 0; ring < 2; ring++) {
        triangle(vertices[ring][i], vertices[ring + 1][i], vertices[ring][next], part);
        triangle(vertices[ring][next], vertices[ring + 1][i], vertices[ring + 1][next], part);
      }
    }
  };
  const solid = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, kind: number) => {
    const plain = geometry.index ? geometry.toNonIndexed() : geometry;
    const attr = plain.getAttribute("position");
    for (let i = 0; i < attr.count; i += 3) {
      const local = [0, 1, 2].map(j => {
        const p = new THREE.Vector3().fromBufferAttribute(attr, i + j);
        if (kind === 3) {
          // Uneven moss margins; the same source vertex always gets the same warp.
          p.x *= .88 + .12 * Math.sin(p.x * 11 + p.z * 7);
          p.z *= .87 + .13 * Math.cos(p.z * 13 - p.x * 5);
        }
        return p;
      });
      const world = local.map(p => p.clone().applyMatrix4(matrix));
      triangle(world[0], world[1], world[2], kind, local);
    }
    if (plain !== geometry) plain.dispose(); geometry.dispose();
  };
  const mound = (x: number, y: number, z: number, sx: number, sy: number, sz: number, kind: number) => {
    solid(new THREE.SphereGeometry(1, 9, 4), new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z), kind);
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

    // Irregular, low pockets growing out from the shadow under the slab.
    // The entire upper sitting surface remains bare stone.
    for (const [x, z, sx, sz] of [
      [-.49, .24, .14, .065], [-.58, .16, .065, .085], [-.43, .31, .075, .045],
      [.22, .49, .11, .055], [.30, .50, .06, .045], [-.12, -.56, .075, .05],
    ]) mound(x, .018, z, sx, .014, sz, 3);

    // Sparse blades in three unequal pockets, rather than a wreath around the seat.
    for (const [x, z, count, rotation] of [[-.54, .25, 7, .8], [.26, .51, 4, 2.1], [-.20, -.59, 3, -.4]]) {
      for (let i = 0; i < count; i++) {
        const angle = rotation + i * 2.399, height = .065 + (i % 4) * .019;
        const base = new THREE.Vector3(x + Math.cos(i * 4.1) * .024, .014, z + Math.sin(i * 3.7) * .025);
        const side = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const lean = new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(.025 + (i % 3) * .011);
        const left = base.clone().addScaledVector(side, -.004), right = base.clone().addScaledVector(side, .004);
        const middle = base.clone().addScaledVector(lean, .45).setY(height * .62);
        const tip = base.clone().add(lean).setY(height);
        triangle(left, right, middle.clone().addScaledVector(side, .002), 2);
        triangle(left, middle.clone().addScaledVector(side, .002), middle.clone().addScaledVector(side, -.002), 2);
        triangle(middle.clone().addScaledVector(side, -.002), middle.clone().addScaledVector(side, .002), tip, 2);
      }
    }

    // A short rotting branch lies tangentially against the right edge, half nestled in.
    const logOrigin = new THREE.Vector3(.62, .075, -.22), yaw = 1.2;
    const toWorld = (p: THREE.Vector3) => new THREE.Vector3(
      logOrigin.x + Math.cos(yaw) * p.x - Math.sin(yaw) * p.z,
      logOrigin.y + p.y, logOrigin.z + Math.sin(yaw) * p.x + Math.cos(yaw) * p.z);
    const rings = [-.255, -.11, .12, .245].map((x, ring) => Array.from({ length: 10 }, (_, i) => {
      const angle = i / 10 * Math.PI * 2;
      const radius = .064 * (1 + Math.sin(i * 5.3 + ring * 1.7) * .13) * (ring === 0 ? .88 : 1);
      const broken = ring === 0 || ring === 3 ? Math.sin(i * 3.7) * .02 : 0;
      return new THREE.Vector3(x + broken, Math.sin(angle) * radius, Math.cos(angle) * radius);
    }));
    const logTriangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kind: number) =>
      triangle(toWorld(a), toWorld(b), toWorld(c), kind, [a, b, c]);
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 10; i++) {
      const next = (i + 1) % 10;
      logTriangle(rings[ring][i], rings[ring + 1][i], rings[ring][next], 4);
      logTriangle(rings[ring][next], rings[ring + 1][i], rings[ring + 1][next], 4);
    }
    // Broken pale end grain encloses a recessed, darker rotten core.
    for (const end of [0, 3]) for (let i = 0; i < 10; i++) {
      const next = (i + 1) % 10, a = rings[end][i], b = rings[end][next];
      const inset = (p: THREE.Vector3) => new THREE.Vector3(p.x + (end === 0 ? .015 : -.015), p.y * .53, p.z * .53);
      logTriangle(a, b, inset(a), 5); logTriangle(b, inset(b), inset(a), 5);
      logTriangle(inset(a), inset(b), new THREE.Vector3(end === 0 ? -.23 : .23, 0, 0), 6);
    }
    // Moss trails along one damp shoulder of the log, with an exposed bark gap.
    for (const [along, width] of [[-.14, .07], [-.055, .09], [.07, .048]]) {
      const p = toWorld(new THREE.Vector3(along, .052, -.013));
      const matrix = new THREE.Matrix4().makeRotationY(-yaw).scale(new THREE.Vector3(width, .009, .035)).setPosition(p);
      solid(new THREE.SphereGeometry(1, 9, 4), matrix, 3);
    }
    // Three tiny, unequal chestnut-red fruiting bodies. No bright white dots.
    for (const [along, side, size, height] of [[.10, .015, .026, .041], [.16, .026, .019, .029], [.19, -.005, .014, .024]]) {
      const p = toWorld(new THREE.Vector3(along, .045, side));
      solid(new THREE.CylinderGeometry(.003, .005, height, 5),
        new THREE.Matrix4().makeTranslation(p.x, p.y + height * .5, p.z), 8);
      solid(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * .57),
        new THREE.Matrix4().makeScale(size, size * .48, size * .83).setPosition(p.x, p.y + height, p.z), 7);
    }
    // Two curled, muted leaves tie the warm log to the cool stone without clutter.
    for (const [x, z, angle, size] of [[.49, .40, -.7, .042], [-.43, .37, .9, .03]]) {
      const center = new THREE.Vector3(x, .017, z);
      const axis = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(size);
      const across = new THREE.Vector3(-axis.z, .009, axis.x).multiplyScalar(.42);
      const a = center.clone().sub(axis), b = center.clone().add(axis);
      triangle(a, center.clone().add(across), b, 9);
      triangle(a, b, center.clone().sub(across).setY(.013), 9);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("kind", new THREE.Float32BufferAttribute(kinds, 1));
  geometry.setAttribute("surface", new THREE.Float32BufferAttribute(surfaces, 3));
  geometry.computeVertexNormals();
  const material = new THREE.ShaderMaterial({
    transparent: true, side: THREE.DoubleSide, uniforms: { uFade: { value: 0 } },
    vertexShader: `attribute float kind; attribute vec3 surface;
      varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind;
      void main(){vAt=position; vNormal=normal; vKind=kind; vSurface=surface;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vAt; varying vec3 vNormal; varying vec3 vSurface; varying float vKind; uniform float uFade;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){
        vec3 n=normalize(vNormal);
        vec2 stoneUV=vAt.xz+vAt.y*vec2(.7,-.4);
        float grain=noise(stoneUV*53.)*.55+noise(stoneUV*173.)*.45;
        float strata=noise(vec2(stoneUV.x*8.,stoneUV.y*34.)+noise(stoneUV*9.)*.6);
        float seam=1.-smoothstep(.035,.08,abs(strata-.48));
        float shade=.55+.45*max(0.,dot(n,normalize(vec3(-.4,1.,.6))));
        // Near-black wet basalt; broken mineral texture catches restrained highlights.
        vec3 color=mix(vec3(.007,.009,.011),vec3(.024,.028,.031),grain)*shade;
        color*=1.-seam*.26;
        float fleck=smoothstep(.80,.96,noise(stoneUV*111.));
        color+=vec3(.009,.010,.010)*fleck*max(n.y,0.);
        if(vKind>1.5&&vKind<2.5) color=mix(vec3(.012,.026,.012),vec3(.048,.071,.024),clamp(vAt.y/.13,0.,1.))*shade;
        if(vKind>2.5&&vKind<3.5){
          float soft=noise(vAt.xz*91.)*.6+noise(vAt.xz*29.)*.4;
          color=mix(vec3(.010,.018,.012),vec3(.027,.045,.021),soft)*shade;
        }
        if(vKind>3.5&&vKind<4.5){
          float around=atan(vSurface.y,vSurface.z);
          float bark=noise(vec2(vSurface.x*13.,around*9.));
          float cracks=smoothstep(.12,.24,noise(vec2(vSurface.x*7.,around*21.)));
          color=mix(vec3(.020,.014,.011),vec3(.078,.058,.038),bark)*mix(.4,1.,cracks)*shade;
        }
        if(vKind>4.5&&vKind<5.5){
          float radius=length(vSurface.yz), rings=.5+.18*sin(radius*620.+noise(vSurface.yz*40.)*3.);
          color=mix(vec3(.037,.026,.017),vec3(.10,.074,.045),rings)*shade;
        }
        if(vKind>5.5&&vKind<6.5) color=mix(vec3(.009,.006,.004),vec3(.028,.018,.011),noise(vSurface.yz*120.))*shade;
        if(vKind>6.5&&vKind<7.5){
          float variation=noise(vAt.xz*180.);
          color=mix(vec3(.085,.015,.010),vec3(.22,.049,.023),variation)*shade;
          color+=vec3(.023,.010,.004)*pow(max(n.y,0.),8.);
        }
        if(vKind>7.5&&vKind<8.5) color=vec3(.10,.067,.041)*shade;
        if(vKind>8.5) color=mix(vec3(.033,.021,.012),vec3(.08,.048,.021),noise(vAt.xz*95.))*shade;
        gl_FragColor=vec4(color,uFade);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.raycast = () => {};
  return mesh;
}
