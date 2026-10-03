import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {VRMLoaderPlugin} from '@pixiv/three-vrm';
import {VRMAnimationLoaderPlugin,createVRMAnimationClip} from '@pixiv/three-vrm-animation';
import {AnimationMixer,Vector3} from 'three';
const parse=async(loader,p)=>{const b=fs.readFileSync(p);return loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');};
const gltf=await parse(new GLTFLoader().register(p=>new VRMLoaderPlugin(p)),'public/avatars/skein.vrm');
const vrm=gltf.userData.vrm;if(!vrm)throw Error('No VRM');
for(const name of ['hips','head','leftHand','rightFoot','leftThumbMetacarpal','rightLittleDistal'])if(!vrm.humanoid.getNormalizedBoneNode(name))throw Error('Missing '+name);
for(const expression of ['blink','aa','happy','sad','relaxed']){if(!vrm.expressionManager.getExpression(expression))throw Error('Missing '+expression);vrm.expressionManager.setValue(expression,.6);vrm.update(.016);vrm.expressionManager.setValue(expression,0);}
for(const side of ['left','right']){
 const arm=vrm.humanoid.getNormalizedBoneNode(side+'UpperArm');
 const hand=vrm.humanoid.getNormalizedBoneNode(side+'Hand');
 vrm.scene.updateMatrixWorld(true);
 const restY=hand.getWorldPosition(new Vector3()).y;
 arm.rotation.z=side==='left'?1.22:-1.22;vrm.update(.016);vrm.scene.updateMatrixWorld(true);
 if(hand.getWorldPosition(new Vector3()).y>restY-.2)throw Error(side+' arm does not lower with Saha idle convention');
 arm.rotation.set(0,0,0);vrm.update(.016);
}
for(const path of ['idle','rb-wave','world-walk']){
 const anim=await parse(new GLTFLoader().register(p=>new VRMAnimationLoaderPlugin(p)),`public/animations/${path}.vrma`);
 const clip=createVRMAnimationClip(anim.userData.vrmAnimations[0],vrm);const mixer=new AnimationMixer(vrm.scene);mixer.clipAction(clip).play();
 for(let i=0;i<30;i++){mixer.update(.1);vrm.update(.1);vrm.scene.updateMatrixWorld(true);vrm.scene.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();const count=o.geometry.attributes.position.count;for(let j=0;j<count;j+=31){const p=o.getVertexPosition(j,new Vector3());if(![p.x,p.y,p.z].every(Number.isFinite))throw Error('Nonfinite vertex');}}});}mixer.stopAllAction();mixer.uncacheRoot(vrm.scene);console.log(path,clip.tracks.length,'tracks passed');
}
console.log('VRM loading, normalized bones, 5 expressions and sampled animated skinning passed');
