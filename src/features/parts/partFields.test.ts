import {describe,it,expect} from 'vitest';
import {locationCandidates,partFieldCandidates,filterCandidateValues} from './partFields';
describe('locationCandidates',()=>{
  it('matches anywhere, keeps existing labels, and removes duplicates',()=>{
    expect(locationCandidates([{location:'0805电阻盒'},{location:'A10'},{location:'0805电阻盒'},{location:''}],'0')).toEqual(['0805电阻盒','A10']);
  });
  it('offers freely entered locations after saving, ignoring case and blank labels',()=>{
    expect(locationCandidates([{location:'新盒 01'},{location:'BoxA'},{location:'  '}],'box')).toEqual(['BoxA']);
    expect(locationCandidates([{location:'新盒 01'}],'新盒')).toEqual(['新盒 01']);
  });
});

describe('full repository candidate cache',()=>{
  it('deduplicates all four fields across the full snapshot instead of a visible subset, excluding empty values',()=>{
    const whole=Array.from({length:500},(_,index)=>({category:index%2?'电阻':'电容',location:'立创仓库',packageName:'0805',brand:'BrandA'}));
    whole.push({category:'隐藏分类',location:'隐藏位置',packageName:'HiddenPackage',brand:'HiddenBrand'}, {category:' ',location:'',packageName:' ',brand:''});
    const candidates=partFieldCandidates(whole);
    expect(candidates.category).toEqual(['电容','电阻','隐藏分类']);
    expect(candidates.location).toEqual(['立创仓库','隐藏位置']);
    expect(candidates.packageName).toEqual(['0805','HiddenPackage']);
    expect(candidates.brand).toEqual(['BrandA','HiddenBrand']);
    expect(filterCandidateValues(candidates.packageName,'hidden')).toEqual(['HiddenPackage']);
    expect(filterCandidateValues(candidates.brand,'denb')).toEqual(['HiddenBrand']);
  });
  it('offers freely saved package and brand values when the refreshed snapshot replaces the candidate cache',()=>{
    const initial=[{category:'电阻',location:'A1',packageName:'0805',brand:'ExistingBrand'}];
    const before=partFieldCandidates(initial);
    const refreshed=partFieldCandidates([...initial,{category:'新分类',location:'新位置',packageName:'NewPackage',brand:'NewBrand'}]);
    expect(before.packageName).toEqual(['0805']);
    expect(before.brand).toEqual(['ExistingBrand']);
    expect(filterCandidateValues(refreshed.packageName,'new')).toEqual(['NewPackage']);
    expect(filterCandidateValues(refreshed.brand,'new')).toEqual(['NewBrand']);
  });
});
