const commonLocations=['0805电阻盒','0603电阻盒','其它电阻盒','电容盒','电源IC盒','其它芯片盒','芯片盒','主控盒','晶体管盒','立创仓库'];
const commonTones=new Map(commonLocations.map((location,index)=>[location,index]));

/** Display-only colour identity; independent of inventory order or visible rows. */
export function locationTagTone(location:string):number|undefined{
  const label=location.trim();
  if(!label)return undefined;
  const common=commonTones.get(label);
  if(common!==undefined)return common;
  let hash=2166136261;
  for(let index=0;index<label.length;index++)hash=Math.imul(hash^label.charCodeAt(index),16777619);
  return (hash>>>0)%commonLocations.length;
}
