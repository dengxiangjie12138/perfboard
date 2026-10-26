import {filterCandidateValues} from './partFields';
interface PartCandidateInputProps {testId:string;listId:string;value:string;candidates:readonly string[];onChange:(value:string)=>void}
/** A native searchable suggestion list that never restricts freely entered text. */
export function PartCandidateInput({testId,listId,value,candidates,onChange}:PartCandidateInputProps){
  return <><input data-testid={testId} type="text" list={listId} value={value} onChange={event=>onChange(event.currentTarget.value)}/><datalist id={listId}>{filterCandidateValues(candidates,value).map(candidate=><option key={candidate} value={candidate}/>)}</datalist></>;
}
