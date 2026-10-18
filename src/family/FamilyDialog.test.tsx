import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FamilyDialog } from './FamilyDialog';
import type { FamilyService, FamilySnapshot } from './familyService';

const OWNER = '00000000-0000-4000-8000-000000000471';
const GROUP = '00000000-0000-4000-8000-000000000479';
const NOW = '2026-10-18T00:00:00Z';
const EMPTY: FamilySnapshot = { group: null, members: [], invitations: [] };
const FAMILY: FamilySnapshot = { group: { id: GROUP, name: '家庭', ownerId: OWNER, createdAt: NOW, updatedAt: NOW }, members: [{ userId: OWNER, displayName: '家長', role: 'owner', joinedAt: NOW }], invitations: [] };
let container: HTMLDivElement; let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function render(overrides: Partial<FamilyService> = {}, initial = EMPTY) {
  const service: FamilyService = { load: vi.fn(async () => initial), preview: vi.fn(), command: vi.fn(async () => ({ snapshot: FAMILY, invitation: null })), ...overrides };
  const onClose = vi.fn();
  await act(async () => root.render(<FamilyDialog userId={OWNER} timezone="Asia/Taipei" factory={() => service} onClose={onClose} />));
  return { service, onClose };
}
function button(label: string) { return [...container.querySelectorAll('button')].find(item => item.textContent === label)!; }
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(item: HTMLElement) { await act(async () => item.click()); }

describe('family dialog confirmed writes', () => {
  it('keeps the creation draft and dialog when a request fails', async () => {
    const { onClose } = await render({ command: vi.fn().mockRejectedValue(new Error('private@example.test')) });
    const input = container.querySelector<HTMLInputElement>('#family-name')!;
    type(input, '我們的家');
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(input.value).toBe('我們的家');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('輸入內容已保留');
    expect(container.textContent).not.toContain('private@example.test');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('prevents a duplicate submission or Escape while waiting for confirmation', async () => {
    let finish!: (value: { snapshot: FamilySnapshot; invitation: null }) => void;
    const command = vi.fn(() => new Promise<{ snapshot: FamilySnapshot; invitation: null }>(resolve => { finish = resolve; }));
    const { onClose } = await render({ command });
    act(() => {
      const form = container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(command).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ snapshot: FAMILY, invitation: null }));
    expect(container.textContent).toContain('最近邀請');
  });
  it('makes dissolution a separate confirmation, preserving personal data in its wording', async () => {
    const { service } = await render({}, FAMILY);
    await click(button('解散家庭'));
    expect(container.textContent).toContain('不會刪除任何人的日曆內容');
    expect(service.command).not.toHaveBeenCalled();
    await click(button('取消'));
    expect(service.command).not.toHaveBeenCalled();
  });
  it('does not turn a failed load into a new-family form', async () => {
    await render({ load: vi.fn().mockRejectedValue(new Error('bad')) });
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).toContain('重新整理');
  });
});
