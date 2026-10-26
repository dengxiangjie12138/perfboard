import { expect, it } from 'vitest';
import { createSheetExample } from './sheet';
import { restoreDesignView } from './viewMemory';
it('restores incomplete manufacturing drafts without requiring save validation', () => {
  const document=createSheetExample(); document.productionSheet!.core=''; document.productionSheet!.windings[0].turns='';
  const value={active:true,dirty:true,document,baseline:createSheetExample(),record:null};
  expect(restoreDesignView(JSON.parse(JSON.stringify(value)))).toEqual(value);
});
it('retains the original record revision and legacy data for optimistic save conflicts', () => {
  const document=createSheetExample(),legacy={...document,productionSheet:undefined};
  const record={id:'old',revision:3,createdAt:'old',updatedAt:'old',document:legacy};
  const restored=restoreDesignView(JSON.parse(JSON.stringify({active:true,dirty:true,document,baseline:document,record})));
  expect(restored?.record?.revision).toBe(3); expect(restored?.record?.document.productionSheet).toBeUndefined();
});
it('keeps an explicit end-editing state and refuses malformed drafts', () => {
  expect(restoreDesignView({active:false,dirty:true})).toEqual({active:false,dirty:false,document:null,baseline:null,record:null});
  expect(restoreDesignView({active:true,dirty:true,document:{schemaVersion:1}})).toBeUndefined();
  const document=createSheetExample(); (document.productionSheet!.windings[0] as unknown as {turns:unknown}).turns=5;
  expect(restoreDesignView({active:true,dirty:true,document,baseline:document,record:null})).toBeUndefined();
});
