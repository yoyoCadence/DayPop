import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

// Test infrastructure only — nothing in `src` outside tests imports this.

/**
 * Minimal stand-in for the PostgREST query builder, for adapter tests.
 *
 * It covers only the chains `SupabaseDayPopRepository` actually builds, and it
 * imitates the two server behaviours the adapter depends on: `owner_id`
 * filtering, and the database — not the client — filling `created_at` and
 * `updated_at`. It is not a Postgres emulator and proves nothing about RLS;
 * real isolation is verified against the project in DP-026.
 */

export type FakeRow = Record<string, unknown>;

export class FakeSupabase {
  readonly tables = new Map<string, FakeRow[]>();
  /** Table name → message, to make one table fail like a rejected request. */
  readonly failures = new Map<string, string>();
  /** Every write the adapter attempted, for asserting what reached the wire. */
  readonly writes: { table: string; row: FakeRow }[] = [];
  /** Server-controlled timestamp handed to inserted rows. */
  serverTime = '2026-08-04T00:00:00.000Z';

  seed(table: string, rows: FakeRow[]) {
    this.tables.set(table, [...rows]);
  }

  rows(table: string): FakeRow[] {
    return this.tables.get(table) ?? [];
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }

  /** The adapter only ever sees the `SupabaseClient` surface it is typed for. */
  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}

type QueryResult = { data: unknown; error: { message: string } | null };

class FakeQuery implements PromiseLike<QueryResult> {
  #filters: [string, unknown][] = [];
  #mode: 'select' | 'upsert' | 'delete' | 'update' = 'select';
  #payload: FakeRow | null = null;
  #single = false;

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.#filters.push([column, value]);
    return this;
  }

  upsert(row: FakeRow) {
    this.#mode = 'upsert';
    this.#payload = row;
    return this;
  }

  /** Patches every row matching the filters, like a PostgREST `PATCH`. */
  update(patch: FakeRow) {
    this.#mode = 'update';
    this.#payload = patch;
    return this;
  }

  delete() {
    this.#mode = 'delete';
    return this;
  }

  single() {
    this.#single = true;
    return this;
  }

  maybeSingle() {
    this.#single = true;
    return this;
  }

  then<Fulfilled = QueryResult, Rejected = never>(
    onfulfilled?: ((value: QueryResult) => Fulfilled | PromiseLike<Fulfilled>) | null,
    onrejected?: ((reason: unknown) => Rejected | PromiseLike<Rejected>) | null,
  ): PromiseLike<Fulfilled | Rejected> {
    return Promise.resolve(this.#run()).then(onfulfilled, onrejected);
  }

  #run(): QueryResult {
    const failure = this.db.failures.get(this.table);
    if (failure) return { data: null, error: { message: failure } };

    const rows = this.db.rows(this.table);
    if (this.#mode === 'upsert') {
      const row = this.#store(rows);
      return { data: row, error: null };
    }
    if (this.#mode === 'update') {
      const patch = this.#payload ?? {};
      const updated: FakeRow[] = [];
      this.db.tables.set(
        this.table,
        rows.map((row) => {
          if (!this.#matches(row)) return row;
          const next = { ...row, ...patch, updated_at: this.db.serverTime };
          this.db.writes.push({ table: this.table, row: patch });
          updated.push(next);
          return next;
        }),
      );
      return { data: updated, error: null };
    }

    if (this.#mode === 'delete') {
      this.db.tables.set(
        this.table,
        rows.filter((row) => !this.#matches(row)),
      );
      return { data: null, error: null };
    }

    const matched = rows.filter((row) => this.#matches(row));
    return { data: this.#single ? (matched[0] ?? null) : matched, error: null };
  }

  #store(rows: FakeRow[]): FakeRow {
    const payload = this.#payload ?? {};
    this.db.writes.push({ table: this.table, row: payload });
    const existing = rows.find((row) => row.id === payload.id);
    // Timestamps come from the server, exactly as the real columns do.
    const stored: FakeRow = {
      ...existing,
      ...payload,
      created_at: existing?.created_at ?? this.db.serverTime,
      updated_at: this.db.serverTime,
    };
    this.db.tables.set(
      this.table,
      existing ? rows.map((row) => (row.id === stored.id ? stored : row)) : [...rows, stored],
    );
    return stored;
  }

  #matches(row: FakeRow): boolean {
    return this.#filters.every(([column, value]) => row[column] === value);
  }
}
