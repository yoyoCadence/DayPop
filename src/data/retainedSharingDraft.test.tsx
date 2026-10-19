import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,describe,expect,it } from 'vitest';
import { createEmptyUserData } from '../domain/types';
import { DataContext,type DataContextValue,type DataActions } from './dataContext';
import { useRetainedSharingDraft,type RetainedSharingDraft } from './retainedSharingDraft';
let root:ReturnType<typeof createRoot>|undefined;let host:HTMLDivElement;
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;});
describe('memory-only sharing draft recovery',()=>{
  it('retains the last dirty input if revocation unmounts its row, without writing browser storage',async()=>{
    const retained:RetainedSharingDraft[]=[];const before=localStorage.length;
    const value:DataContextValue={state:{status:'ready',data:createEmptyUserData()},actions:{} as DataActions,
      capabilities:{eventAttachments:false},refresh:()=>{},keepSharingDraft:draft=>retained.push(draft),discardSharingDraft:()=>{}};
    function Editor({text,enabled}:{text:string;enabled:boolean}) {
      useRetainedSharingDraft('todo-title','待辦標題草稿',text,true,enabled);return <input value={text} readOnly/>;
    }
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<DataContext.Provider value={value}><Editor text="尚未保存的輸入" enabled/></DataContext.Provider>));
    await act(async()=>root!.render(<DataContext.Provider value={value}><Editor text="尚未保存的輸入" enabled={false}/></DataContext.Provider>));
    await act(async()=>root!.render(<DataContext.Provider value={value}/>));
    expect(retained).toEqual([{key:'todo-title',label:'待辦標題草稿',value:'尚未保存的輸入'}]);
    expect(localStorage.length).toBe(before);
  });
  it('does not retain a successfully saved or explicitly cancelled input',async()=>{
    const retained:RetainedSharingDraft[]=[];const discarded:string[]=[];let discard!:()=>void;
    const value:DataContextValue={state:{status:'ready',data:createEmptyUserData()},actions:{} as DataActions,
      capabilities:{eventAttachments:false},refresh:()=>{},keepSharingDraft:draft=>retained.push(draft),discardSharingDraft:key=>discarded.push(key)};
    function Editor(){const protection=useRetainedSharingDraft('todo-date','待辦日期草稿','2026-10-20',true,true);discard=protection.discard;return null;}
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<DataContext.Provider value={value}><Editor/></DataContext.Provider>));
    await act(async()=>{discard();root!.render(<DataContext.Provider value={value}/>);});
    expect(retained).toEqual([]);expect(discarded).toEqual(['todo-date']);
  });
});
