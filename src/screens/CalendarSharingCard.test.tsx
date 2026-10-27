import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { AuthContext, type AuthContextValue } from '../auth/authContext';
import { DataProvider } from '../data/DataProvider';
import { DataContext, useDayPopDataState } from '../data/dataContext';
import { LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';
import { CalendarSharingCard } from './CalendarSharingCard';

const USER='00000000-0000-4000-8000-000000000030';
let host:HTMLDivElement;
let root:Root;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});

async function render(overrides:Partial<AuthContextValue>={}) {
  const retry=vi.fn();
  const openAuth=vi.fn();
  const auth:AuthContextValue={
    session:null,user:{id:USER} as User,initializing:false,isPasswordRecovery:false,
    googleAuthStatus:'disabled',configurationError:null,signIn:vi.fn(),signUp:vi.fn(),signInWithGoogle:vi.fn(),
    requestPasswordReset:vi.fn(),updatePassword:vi.fn(),dismissPasswordRecovery:vi.fn(),signOut:vi.fn(),...overrides,
  };
  function UnavailableShare() {
    const value=useDayPopDataState();
    return <DataContext.Provider value={{...value,sharing:{userId:USER,available:false,shares:[]},revalidateShares:retry}}>
      <CalendarSharingCard onOpenAuth={openAuth}/>
    </DataContext.Provider>;
  }
  await act(async()=>root.render(<AuthContext.Provider value={auth}>
    <DataProvider repository={new LocalDayPopRepository(new MemoryStorage())}><UnavailableShare/></DataProvider>
  </AuthContext.Provider>));
  return {retry,openAuth};
}
function retryButton() {
  return [...host.querySelectorAll('button')].find(button=>button.textContent==='重新確認分享');
}
describe('sharing retry while received data is unavailable',()=>{
  it('lets a confirmed account retry from the existing settings screen',async()=>{
    const {retry,openAuth}=await render();
    expect(host.textContent).toContain('目前只顯示自己的資料');
    expect(retryButton()).toBeDefined();
    expect(retryButton()!.disabled).toBe(false);
    await act(async()=>retryButton()!.click());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(openAuth).not.toHaveBeenCalled();
  });
  it.each([
    ['guest',{user:null}],
    ['unconfirmed session',{sessionUnconfirmed:true}],
    ['configuration failure',{configurationError:'not configured'}],
  ] as const)('does not issue retry requests for %s',async(_label,auth)=>{
    const {retry}=await render(auth);
    const button=retryButton();
    expect(button===undefined || button.disabled).toBe(true);
    await act(async()=>button?.click());
    expect(retry).not.toHaveBeenCalled();
  });
});
