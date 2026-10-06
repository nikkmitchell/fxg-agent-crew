import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {InputHub} from './input';
function frame(joints:Record<string,number[]>){const hand=new Map(Object.keys(joints).map(n=>[n,{name:n}]));return {session:{inputSources:[{handedness:'left',hand}]},getJointPose:(j:any)=>({transform:{matrix:new THREE.Matrix4().makeTranslation(...joints[j.name] as [number,number,number]).elements}})};}
describe('Thing tracked hands',()=>{
 it('converts reference through origin and rotated/scaled Thing, exposes only valid joints, clears on loss',()=>{
  const hub=new InputHub({camera:()=>new THREE.PerspectiveCamera(),element:()=>null,me:()=>null});
  const root=new THREE.Group();root.position.set(2,0,0);root.rotation.y=Math.PI/2;root.scale.setScalar(2);root.updateMatrixWorld();
  const origin=new THREE.Group();origin.position.set(1,0,0);origin.updateMatrixWorld();
  const input=hub.forInstance(root,{model:false});
  hub.readTips(frame({'wrist':[1,1,0],'thumb-tip':[1,1,.1],'index-finger-tip':[1,1,.2]}) as any,{} as any,origin);
  input.frame(.016);expect(input.hands).toHaveLength(1);expect(input.hands[0].joints.wrist!.y).toBeCloseTo(.5);expect(input.hands[0].joints['index-finger-tip']!.x).toBeCloseTo(-.1);
  const copy=input.hands;copy[0].joints.wrist!.set(99,99,99);expect(input.hands[0].joints.wrist!.y).toBeCloseTo(.5);
  const miniature=hub.forInstance(root,{model:true});expect(miniature.hands).toEqual([]);input.dispose();expect(input.hands).toEqual([]);
  hub.readTips(null,null,null);expect(hub.hands).toEqual([]);hub.dispose();
 });
 it('does not fabricate joints for controllers or a missing wrist',()=>{
  const hub=new InputHub({camera:()=>new THREE.PerspectiveCamera(),element:()=>null,me:()=>null});
  hub.readTips(frame({'index-finger-tip':[0,1,0]}) as any,{} as any,null);expect(hub.hands).toEqual([]);hub.dispose();
 });
});
