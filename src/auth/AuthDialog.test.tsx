import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from './authContext';
import { AuthDialog } from './AuthDialog';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function authValue(signUp: AuthContextValue['signUp']): AuthContextValue {
  return {
    session: null,
    user: null,
    initializing: false,
    isPasswordRecovery: false,
    googleAuthStatus: 'enabled',
    configurationError: null,
    signIn: async () => {},
    signUp,
    signInWithGoogle: async () => {},
    requestPasswordReset: async () => {},
    updatePassword: async () => {},
    dismissPasswordRecovery: () => {},
    signOut: async () => {},
  };
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AuthDialog signup completion', () => {
  it('clears credentials and replaces the signup form after confirmation email is sent', async () => {
    const signUp = vi.fn(async () => ({ needsEmailConfirmation: true }));
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <AuthContext.Provider value={authValue(signUp)}>
          <AuthDialog open onClose={onClose} />
        </AuthContext.Provider>,
      );
    });

    const signupTab = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '註冊',
    ) as HTMLButtonElement;
    await act(async () => signupTab.click());

    const email = container.querySelector('input[type="email"]') as HTMLInputElement;
    const password = container.querySelector('input[type="password"]') as HTMLInputElement;
    await act(async () => {
      setInput(email, 'person@example.com');
      setInput(password, 'correct-horse');
    });
    await act(async () => {
      container
        .querySelector('form')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(signUp).toHaveBeenCalledWith('person@example.com', 'correct-horse');
    expect(container.textContent).toContain('檢查你的 Email');
    expect(container.textContent).toContain('註冊完成，請到 Email 點擊驗證連結。');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toContain('建立帳號');
    expect(container.textContent).not.toContain('使用 Google 帳號繼續');

    const done = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === '完成',
    ) as HTMLButtonElement;
    await act(async () => done.click());

    expect(onClose).toHaveBeenCalledOnce();
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('');
  });
});
