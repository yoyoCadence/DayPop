import { describe, expect, it } from 'vitest';
import { FakeSupabase } from './fakeSupabase';

describe('FakeSupabase existing todos FK cascade (DP-115)', () => {
  it('cascades out-of-order descendants but leaves unrelated rows', async () => {
    const db = new FakeSupabase();
    const common = { owner_id: 'owner', calendar_id: 'calendar' };
    db.seed('todos', [
      { ...common, id: 'grandchild', parent_id: 'child' },
      { ...common, id: 'unrelated', parent_id: null },
      { ...common, id: 'child', parent_id: 'parent' },
      { ...common, id: 'parent', parent_id: null },
    ]);
    await db.from('todos').delete().eq('owner_id', 'owner').eq('id', 'parent');
    expect(db.rows('todos')).toEqual([{ ...common, id: 'unrelated', parent_id: null }]);
  });
  it('a filtered deletion that matches no row does not start a cascade', async () => {
    const db = new FakeSupabase();
    const rows = [{ id: 'parent', parent_id: null, owner_id: 'owner', calendar_id: 'calendar' }];
    db.seed('todos', rows);
    await db.from('todos').delete().eq('owner_id', 'other').eq('id', 'parent');
    expect(db.rows('todos')).toEqual(rows);
  });
});
