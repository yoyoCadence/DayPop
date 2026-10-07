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
  /**
   * Table name → message: the write is committed, then its promise rejects —
   * a response lost after commit, which is what makes a retry dangerous
   * (DP-142). Reads are unaffected, so the account can still be loaded.
   */
  readonly lostResponses = new Map<string, string>();
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

  /**
   * Emulates the `on delete cascade` foreign keys `event_exceptions` and
   * `event_attachments` declare on `events` — DP-082.
   *
   * Without this the fake keeps an exception row pointing at an event that no
   * longer exists, so a `load()` after deleting a series would hand the domain
   * a document Postgres could never have produced. See
   * `event_exceptions_event_owner_fk`,
   * `event_exceptions_replacement_owner_fk` and
   * `event_attachments_event_owner_fk` in
   * `20260801092905_daypop_core_schema.sql`.
   *
   * The attachment half matters as much as the exception half: it is precisely
   * *because* the metadata disappears on its own that the Storage object has to
   * be queued first, and a fake that kept the metadata would have hidden that.
   */
  cascadeDeletedEvents(deletedIds: Set<string>) {
    if (deletedIds.size === 0) return;
    this.tables.set(
      'event_exceptions',
      this.rows('event_exceptions').filter(
        (row) =>
          !deletedIds.has(String(row.event_id)) &&
          !(row.replacement_event_id != null && deletedIds.has(String(row.replacement_event_id))),
      ),
    );
    this.tables.set(
      'event_attachments',
      this.rows('event_attachments').filter((row) => !deletedIds.has(String(row.event_id))),
    );
  }

  /** Models the existing composite todos parent FK, independently of domain edits. */
  cascadeDeletedTodos(removed: FakeRow[]) {
    const rows = this.rows('todos');
    const deleted = new Set<FakeRow>();
    const queue = [...removed];
    for (let index = 0; index < queue.length; index += 1) {
      const parent = queue[index]!;
      for (const row of rows) {
        if (deleted.has(row) || row.parent_id !== parent.id || row.owner_id !== parent.owner_id || row.calendar_id !== parent.calendar_id) continue;
        deleted.add(row);
        queue.push(row);
      }
    }
    this.tables.set('todos', rows.filter((row) => !deleted.has(row)));
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
    if (name === 'cancel_event_occurrence' || name === 'replace_event_occurrence') {
      return this.#occurrenceChange(name, args);
    }
    if (name === 'delete_calendar_with_reassignment') {
      return this.#deleteCalendar(String(args.p_calendar_id));
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
      this.cascadeDeletedEvents(new Set([String(args.p_event_id)]));
      return { data: true, error: null };
    }
    return { data: null, error: { message: `unsupported rpc ${name}` } };
  }

  /**
   * `delete_calendar_with_reassignment` — `20261007000000_delete_calendar_rpc.sql`.
   *
   * Modelled as the function does it, in one step with nothing observable in
   * between: the rows move, the calendar goes, and only then is the survivor
   * promoted, so the one-default index never sees two defaults. The target is
   * the surviving default, else the first survivor by `sort_order`, then
   * `created_at`, then `id`. An unknown id is `false`, not an error; the only
   * calendar is an error. The real function is what pgTAP checks
   * (`supabase/tests/database/delete_calendar.test.sql`).
   */
  #deleteCalendar(id: string): QueryResult {
    const calendars = this.rows('calendars');
    const doomed = calendars.find((row) => row.id === id);
    if (!doomed) return { data: false, error: null };
    const target = calendars
      .filter((row) => row.owner_id === doomed.owner_id && row.id !== id)
      .sort(
        (left, right) =>
          Number(Boolean(right.is_default)) - Number(Boolean(left.is_default)) ||
          Number(left.sort_order) - Number(right.sort_order) ||
          String(left.created_at).localeCompare(String(right.created_at)) ||
          String(left.id).localeCompare(String(right.id)),
      )[0];
    if (!target) return { data: null, error: { message: 'cannot delete the only calendar' } };

    for (const table of ['events', 'todos', 'stickers']) {
      this.tables.set(
        table,
        this.rows(table).map((row) =>
          row.calendar_id === id && row.owner_id === doomed.owner_id
            ? { ...row, calendar_id: target.id, updated_at: this.serverTime }
            : row,
        ),
      );
    }
    this.tables.set(
      'calendars',
      calendars
        .filter((row) => row.id !== id)
        .map((row) =>
          row.id === target.id && !row.is_default
            ? { ...row, is_default: true, updated_at: this.serverTime }
            : row,
        ),
    );
    return { data: true, error: null };
  }

  /**
   * The DP-082 occurrence RPCs — `20260830000000_event_occurrence_rpcs.sql`.
   *
   * Modelled rather than stubbed, because the two faults review found in the
   * client-side version are only visible if the fake reproduces the parts of
   * Postgres that caught them: the partial unique index on (event, occurrence),
   * which is why a retry with a fresh id must not insert a second row, and the
   * cleanup queue, which is why a deleted replacement's Storage objects have to
   * be enqueued rather than dropped with the cascade.
   */
  #occurrenceChange(
    name: 'cancel_event_occurrence' | 'replace_event_occurrence',
    args: Record<string, unknown>,
  ): QueryResult {
    const failure = this.failures.get('event_exceptions');
    if (failure) return { data: null, error: { message: failure } };

    const eventId = String(args.p_event_id);
    const owner = this.rows('events').find((row) => row.id === eventId);
    if (!owner || owner.recurrence_rule == null) {
      return { data: null, error: { message: 'event is not a recurring event owned by the caller' } };
    }
    const ownerId = String(owner.owner_id);
    const date = args.p_occurrence_date ?? null;
    const startsAt = args.p_occurrence_starts_at ?? null;
    if ((date === null) === (startsAt === null)) {
      return { data: null, error: { message: 'exactly one occurrence key is required' } };
    }

    // The server reconciles against the stored row, never the proposed id.
    const exceptions = this.rows('event_exceptions');
    const existing = exceptions.find(
      (row) =>
        row.event_id === eventId &&
        (row.occurrence_date ?? null) === date &&
        (row.occurrence_starts_at ?? null) === startsAt,
    );

    let replacementId: string | null = null;
    let storedEvent: FakeRow | null = null;
    if (name === 'replace_event_occurrence') {
      const payload = isFakeRow(args.p_replacement) ? args.p_replacement : {};
      replacementId =
        (existing?.replacement_event_id as string | undefined) ??
        (payload.id as string | undefined) ??
        `${eventId}-replacement`;
      const events = this.rows('events');
      const previous = events.find((row) => row.id === replacementId);
      storedEvent = {
        ...payload,
        id: replacementId,
        owner_id: ownerId,
        recurrence_rule: null,
        created_at: previous?.created_at ?? this.serverTime,
        updated_at: this.serverTime,
      };
      this.tables.set(
        'events',
        previous
          ? events.map((row) => (row.id === replacementId ? storedEvent! : row))
          : [...events, storedEvent],
      );
    }

    const stored: FakeRow = {
      id: existing?.id ?? args.p_exception_id ?? `${eventId}-exception`,
      owner_id: ownerId,
      event_id: eventId,
      occurrence_date: date,
      occurrence_starts_at: startsAt,
      is_cancelled: name === 'cancel_event_occurrence',
      replacement_event_id: replacementId,
      created_at: existing?.created_at ?? this.serverTime,
      updated_at: this.serverTime,
    };
    this.tables.set(
      'event_exceptions',
      existing
        ? this.rows('event_exceptions').map((row) => (row.id === existing.id ? stored : row))
        : [...this.rows('event_exceptions'), stored],
    );
    this.writes.push({ table: 'event_exceptions', row: stored });

    let enqueued = 0;
    if (name === 'cancel_event_occurrence' && existing?.replacement_event_id != null) {
      const superseded = String(existing.replacement_event_id);
      const attachments = this.rows('event_attachments').filter(
        (row) => row.event_id === superseded,
      );
      // The whole point of the RPC: the objects outlive the cascade only if
      // something queued them first.
      attachments.forEach((row) => this.#queueObject(row));
      enqueued = attachments.length;
      this.tables.set(
        'events',
        this.rows('events').filter((row) => row.id !== superseded),
      );
      this.cascadeDeletedEvents(new Set([superseded]));
    }

    return {
      data: {
        exception: stored,
        event: storedEvent,
        enqueued_cleanup: enqueued,
      } as unknown as FakeRow,
      error: null,
    };
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
    const lost = this.#mode === 'select' ? undefined : this.db.lostResponses.get(this.table);
    const result = rejection
      ? Promise.reject(new Error(rejection))
      : lost
        ? Promise.resolve(this.#run()).then(() => {
            throw new Error(lost);
          })
        : Promise.resolve(this.#run());
    return result.then(onfulfilled, onrejected);
  }

  #run(): QueryResult {
    const failure = this.db.failures.get(this.table);
    if (failure) return { data: null, error: { message: failure } };

    const rows = this.db.rows(this.table);
    if (this.#mode === 'insert' || this.#mode === 'upsert') {
      const violation = this.#foreignKeyViolation();
      if (violation) return { data: null, error: { message: violation } };
      const row = this.#store(rows);
      const duplicateDefault = this.#defaultCalendarViolation();
      if (duplicateDefault) {
        this.db.tables.set(this.table, rows);
        return { data: null, error: { message: duplicateDefault } };
      }
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
      const duplicateDefault = this.#defaultCalendarViolation();
      if (duplicateDefault) {
        this.db.tables.set(this.table, rows);
        return { data: null, error: { message: duplicateDefault } };
      }
      return { data: this.#single ? (updated[0] ?? null) : updated, error: null };
    }

    if (this.#mode === 'delete') {
      const removed = rows.filter((row) => this.#matches(row));
      this.db.tables.set(
        this.table,
        rows.filter((row) => !this.#matches(row)),
      );
      if (this.table === 'events') {
        this.db.cascadeDeletedEvents(new Set(removed.map((row) => String(row.id))));
      }
      if (this.table === 'todos') this.db.cascadeDeletedTodos(removed);
      return { data: null, error: null };
    }

    const matched = rows.filter((row) => this.#matches(row));
    return { data: this.#single ? (matched[0] ?? null) : matched, error: null };
  }

  /**
   * `calendars_one_default_per_owner_idx` — a partial unique index, so it is
   * checked after every statement and cannot be deferred to the end of a
   * client-side sequence. Left unmodelled, this fake accepted "promote the
   * survivor, then delete the old default" as separate requests, which a real
   * database rejects at the first of the two (DP-138).
   */
  #defaultCalendarViolation(): string | null {
    if (this.table !== 'calendars') return null;
    const owners = new Set<unknown>();
    for (const row of this.db.rows('calendars')) {
      if (!row.is_default) continue;
      if (owners.has(row.owner_id)) {
        return 'duplicate key value violates unique constraint "calendars_one_default_per_owner_idx"';
      }
      owners.add(row.owner_id);
    }
    return null;
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

  /**
   * The `event_exceptions` → `events` foreign keys, refused at write time as
   * Postgres would — DP-082.
   *
   * Without this the fake accepts an exception pointing at an event that does
   * not exist yet, which is exactly the mistake
   * `replaceEventOccurrence()`'s write order avoids. Verified by swapping its
   * two writes and watching the contract test fail.
   */
  #foreignKeyViolation(): string | null {
    if (this.table !== 'event_exceptions') return null;
    const payload = this.#payload ?? {};
    const eventIds = new Set(this.db.rows('events').map((row) => String(row.id)));
    for (const column of ['event_id', 'replacement_event_id'] as const) {
      const value = payload[column];
      if (value != null && !eventIds.has(String(value))) {
        return `insert or update on table "event_exceptions" violates foreign key constraint on ${column}`;
      }
    }

    /*
     * `event_exceptions_event_date_unique_idx` and `..._time_unique_idx` — the
     * two **partial** unique indexes, and the reason DP-082's occurrence writes
     * had to move into an RPC.
     *
     * A PostgREST `upsert` infers its conflict target from the primary key, so
     * a retry that proposes a fresh exception id lands here as a second row for
     * an occurrence that already has one. Without this rule the fake accepted
     * it and the bug was invisible; with it, any return to a direct
     * `.from('event_exceptions').upsert()` fails instead of shipping.
     */
    for (const column of ['occurrence_date', 'occurrence_starts_at'] as const) {
      const value = payload[column];
      if (value == null) continue;
      const clash = this.db
        .rows('event_exceptions')
        .some(
          (row) =>
            row.id !== payload.id &&
            row.event_id === payload.event_id &&
            row[column] === value,
        );
      if (clash) {
        return `duplicate key value violates unique constraint on (event_id, ${column})`;
      }
    }
    return null;
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
