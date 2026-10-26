import type {Part} from '../../types';
export type PartCandidateField='category'|'location'|'packageName'|'brand';
export type PartFieldCandidates=Record<PartCandidateField,string[]>;
const candidateFields:PartCandidateField[]=['category','location','packageName','brand'];

/** Aggregate the complete cached repository snapshot once per refresh. */
export function partFieldCandidates(parts:Pick<Part,PartCandidateField>[]):PartFieldCandidates{
  const values:Record<PartCandidateField,Set<string>>={category:new Set(),location:new Set(),packageName:new Set(),brand:new Set()};
  for(const part of parts)for(const field of candidateFields){
    const value=part[field]??'';
    if(value.trim())values[field].add(value);
  }
  return {category:[...values.category].sort(),location:[...values.location].sort(),packageName:[...values.packageName].sort(),brand:[...values.brand].sort()};
}
export function filterCandidateValues(values:readonly string[],query:string):string[]{
  const needle=query.trim().toLocaleLowerCase();
  return values.filter(value=>value.toLocaleLowerCase().includes(needle));
}
export function locationCandidates(parts:Pick<Part,'location'>[],query:string):string[]{
  const values=[...new Set(parts.map(part=>part.location).filter(location=>location.trim()!==''))].sort();
  return filterCandidateValues(values,query);
}
