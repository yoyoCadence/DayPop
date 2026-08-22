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
  /** Table name → message, to imitate a transport-level promise rejection. */
  readonly rejections = new Map<string, string>();
  /** Every write the adapter attempted, for asserting what reached the wire. */
  readonly writes: { table: string; row: FakeRow }[] = [];
  /** Every RPC call, including its serialized argument payload. */
  readonly rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  readonly objects = new Map<string, Blob>();
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

  readonly storage = {
    from: (bucket: string) => new FakeStorageBucket(this, bucket),
  };

  async rpc(name: string, args: Record<string, unknown>): Promise<QueryResult> {
    this.rpcCalls.push({ name, args: structuredClone(args) });
    const failure = this.failures.get(`rpc:${name}`);
    if (failure) return { data: null, error: { message: failure } };
    if (name === 'replace_daypop_data' || name === 'append_daypop_ics') {
      return this.#importData(name, args.p_payload);
    }
    if (name === 'finalize_event_attachment_upload') {
      const metadataFailure = this.failures.get('event_attachments');
      if (metadataFailure) return { data: null, error: { message: metadataFailure } };
      const jobs = this.rows('attachment_cleanup_jobs');
      const ownerId = typeof args.p_object_path === 'string'
        ? args.p_object_path.split('/')[0]
        : undefined;
      const job = jobs.find(
        (row) => row.owner_id === ownerId && row.object_path === args.p_object_path,
      );
      if (!job) return { data: null, error: { message: 'attachment cleanup job is missing' } };
      const row: FakeRow = {
        id: args.p_id,
        owner_id: job.owner_id,
        event_id: args.p_event_id,
        object_path: args.p_object_path,
        file_name: args.p_file_name,
        mime_type: args.p_mime_type,
        size_bytes: args.p_size_bytes,
        created_at: this.serverTime,
        updated_at: this.serverTime,
      };
      this.tables.set(
        'attachment_cleanup_jobs',
        jobs.filter((item) => item !== job),
      );
      this.tables.set('event_attachments', [...this.rows('event_attachments'), row]);
      this.writes.push({ table: 'event_attachments', row });
      return { data: row, error: null };
    }
    if (name === 'delete_event_attachment_with_cleanup') {
      const attachments = this.rows('event_attachments');
      const target = attachments.find((row) => row.id === args.p_attachment_id);
      if (!target) return { data: false, error: null };
      this.#queueObject(target);
      this.tables.set(
        'event_attachments',
        attachments.filter((row) => row.id !== args.p_attachment_id),
      );
      return { data: true, error: null };
    }
    if (name === 'delete_event_with_attachment_cleanup') {
      const events = this.rows('events');
      const target = events.find((row) => row.id === args.p_event_id);
      if (!target) return { data: false, error: null };
      const attachments = this.rows('event_attachments');
      attachments
        .filter((row) => row.event_id === args.p_event_id)
        .forEach((row) => this.#queueObject(row));
      this.tables.set(
        'event_attachments',
        attachments.filter((row) => row.event_id !== args.p_event_id),
      );
      this.tables.set(
        'events',
        events.filter((row) => row.id !== args.p_event_id),
      );
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unsupported rpc ${name}` } };
  }

  #importData(name: 'replace_daypop_data' | 'append_daypop_ics', value: unknown): QueryResult {
    if (!isFakeRow(value)) return { data: null, error: { message: 'invalid import payload' } };
    const ownerId = this.rows('user_preferences')[0]?.user_id;
    if (typeof ownerId !== 'string') {
      return { data: null, error: { message: 'account is not bootstrapped' } };
    }

    const append = name === 'append_daypop_ics';
    for (const [payloadKey, table] of [
      ['events', 'events'],
      ['event_exceptions', 'event_exceptions'],
    ] as const) {
      const incoming = Array.isArray(value[payloadKey]) ? value[payloadKey] : [];
      const rows = incoming.filter(isFakeRow).map((row) => this.#importRow(row, ownerId));
      this.tables.set(table, append ? [...this.rows(table), ...rows] : rows);
    }

    if (!append) {
      for (const [payloadKey, table] of [
        ['calendars', 'calendars'],
        ['todos', 'todos'],
        ['stickers', 'stickers'],
      ] as const) {
        const incoming = Array.isArray(value[payloadKey]) ? value[payloadKey] : [];
        this.tables.set(
          table,
          incoming.filter(isFakeRow).map((row) => this.#importRow(row, ownerId)),
        );
      }
      if (isFakeRow(value.preferences)) {
        this.tables.set('user_preferences', [
          {
            ...value.preferences,
            user_id: ownerId,
            created_at: this.rows('user_preferences')[0]?.created_at ?? this.serverTime,
            updated_at: this.serverTime,
          },
        ]);
      }
    }
    return { data: undefined, error: null };
  }

  #importRow(row: FakeRow, ownerId: string): FakeRow {
    const stored = {
      ...row,
      owner_id: ownerId,
      created_at: this.serverTime,
      updated_at: this.serverTime,
    };
    this.writes.push({ table: 'rpc-import', row: stored });
    return stored;
  }

  #queueObject(row: FakeRow) {
    const jobs = this.rows('attachment_cleanup_jobs');
    if (jobs.some((job) => job.object_path === row.object_path)) return;
    this.tables.set('attachment_cleanup_jobs', [
      ...jobs,
      {
        id: crypto.randomUUID(),
        owner_id: row.owner_id,
        bucket_id: 'event-attachments',
        object_path: row.object_path,
        created_at: this.serverTime,
      },
    ]);
  }

  /** The adapter only ever sees the `SupabaseClient` surface it is typed for. */
  asClient(): SupabaseClient<Database> {
    return this as unknown as SupabaseClient<Database>;
  }
}

function isFakeRow(value: unknown): value is FakeRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type QueryResult = { data: unknown; error: { message: string } | null };

class FakeQuery implements PromiseLike<QueryResult> {
  #filters: [string, unknown][] = [];
  #inFilters: [string, unknown[]][] = [];
  #mode: 'select' | 'insert' | 'upsert' | 'delete' | 'update' = 'select';
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

  in(column: string, values: unknown[]) {
    this.#inFilters.push([column, values]);
    return this;
  }

  insert(row: FakeRow) {
    this.#mode = 'insert';
    this.#payload = row;
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
    const rejection = this.db.rejections.get(this.table);
    const result = rejection
      ? Promise.reject(new Error(rejection))
      : Promise.resolve(this.#run());
    return result.then(onfulfilled, onrejected);
  }

  #run(): QueryResult {
    const failure = this.db.failures.get(this.table);
    if (failure) return { data: null, error: { message: failure } };

    const rows = this.db.rows(this.table);
    if (this.#mode === 'insert' || this.#mode === 'upsert') {
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
    return (
      this.#filters.every(([column, value]) => row[column] === value) &&
      this.#inFilters.every(([column, values]) => values.includes(row[column]))
    );
  }
}

class FakeStorageBucket {
  constructor(
    private readonly db: FakeSupabase,
    private readonly bucket: string,
  ) {}

  async upload(path: string, file: Blob) {
    const failure = this.db.failures.get('storage:upload');
    if (failure) return { data: null, error: { message: failure } };
    const key = `${this.bucket}/${path}`;
    if (this.db.objects.has(key)) {
      return { data: null, error: { message: 'object already exists' } };
    }
    this.db.objects.set(key, file);
    return { data: { path }, error: null };
  }

  async remove(paths: string[]) {
    const failure = this.db.failures.get('storage:remove');
    if (failure) return { data: null, error: { message: failure } };
    paths.forEach((path) => this.db.objects.delete(`${this.bucket}/${path}`));
    return { data: paths.map((name) => ({ name })), error: null };
  }

  async createSignedUrl(path: string) {
    const failure = this.db.failures.get('storage:signed-url');
    if (failure) return { data: null, error: { message: failure } };
    return { data: { signedUrl: `https://storage.test/${this.bucket}/${path}?signed=1` }, error: null };
  }
}
