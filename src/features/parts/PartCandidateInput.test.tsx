import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ChangeEvent,InputHTMLAttributes,ReactElement} from 'react';
import {PartCandidateInput} from './PartCandidateInput';

it('renders a searchable native package/brand suggestion field without requiring a listed value',()=>{
  const html=renderToStaticMarkup(<PartCandidateInput testId="part-package" listId="part-packages" value="sot" candidates={['SOT-23','LQFP48']} onChange={()=>{}}/>);
  expect(html).toContain('data-testid="part-package"');
  expect(html).toContain('list="part-packages"');
  expect(html).toContain('<datalist id="part-packages"><option value="SOT-23">');
  expect(html).not.toContain('LQFP48');
  expect(html).not.toContain('required');
});
it('passes existing selections, new free text, and clearing through the same optional field handler',()=>{
  const onChange=vi.fn();
  const view=PartCandidateInput({testId:'part-brand',listId:'part-brands',value:'',candidates:['ExistingBrand'],onChange});
  const input=view.props.children[0] as ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  for(const value of ['ExistingBrand','NewUnlistedBrand',''])input.props.onChange?.({currentTarget:{value}} as ChangeEvent<HTMLInputElement>);
  expect(onChange.mock.calls).toEqual([['ExistingBrand'],['NewUnlistedBrand'],['']]);
});
