/*
  A stand-in for the Supabase client, for render tests.

  It answers the handful of calls the app makes — table reads with equality
  filters, updates, RPCs, Edge Function calls and the auth session — from
  fixtures each test sets up, so the real session, data and screen code all
  run. Anything the app asks for that a test did not set up comes back empty.
*/

export type Row = Record<string, unknown>

export interface Fixtures {
  user: { id: string; email: string } | null
  tables: Record<string, Row[]>
  rpc: Record<string, (args: Record<string, unknown>) => unknown>
  functions: Record<string, (body: Record<string, unknown>) => { data?: unknown; error?: { message: string } }>
  /** Fills in what the database would for an inserted row: ids, defaults. */
  onInsert: (table: string, row: Row) => Row
}

const DEFAULTS: Fixtures = {
  user: null,
  tables: {},
  rpc: {},
  functions: {},
  onInsert: (table, row) => ({ id: `${table}-new`, ...row })
}

let fixtures: Fixtures = DEFAULTS
let authListener: ((event: string, session: unknown) => void) | null = null

/** Every write and call the app made, in order, for assertions. */
export const calls: Array<{ kind: 'insert' | 'update' | 'rpc' | 'function'; name: string; args: unknown }> = []

export function setFixtures(next: Partial<Fixtures>) {
  fixtures = { ...DEFAULTS, ...next }
  calls.length = 0
}

const result = (data: unknown, error: { message: string } | null = null) => ({ data, error })

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = []
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private patch: Row | null = null
  private inserted: Row[] | null = null

  constructor(private table: string) {}

  select() {
    return this
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
    return this
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }
  order() {
    return this
  }
  limit() {
    return this
  }
  insert(rows: Row | Row[]) {
    const list = (Array.isArray(rows) ? rows : [rows]).map((row) => fixtures.onInsert(this.table, row))
    calls.push({ kind: 'insert', name: this.table, args: rows })
    fixtures.tables[this.table] = [...(fixtures.tables[this.table] ?? []), ...list]
    this.inserted = list
    return this
  }
  update(patch: Row) {
    this.patch = patch
    calls.push({ kind: 'update', name: this.table, args: patch })
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }

  private execute() {
    const rows =
      this.inserted ?? (fixtures.tables[this.table] ?? []).filter((row) => this.filters.every((keep) => keep(row)))
    if (this.patch) rows.forEach((row) => Object.assign(row, this.patch))
    if (this.mode === 'many') return result(rows)
    if (rows.length === 0 && this.mode === 'single') return result(null, { message: 'No rows found' })
    return result(rows[0] ?? null)
  }

  then<A = { data: unknown; error: { message: string } | null }, B = never>(
    resolve?: ((value: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.execute()).then(resolve, reject)
  }
}

function session() {
  const user = fixtures.user
  if (!user) return null
  return {
    user: { id: user.id, email: user.email },
    access_token: 'test-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600
  }
}

const channel = {
  on() {
    return channel
  },
  subscribe() {
    return channel
  }
}

export const fakeSupabase = {
  from: (table: string) => new Query(table),

  rpc(name: string, args: Record<string, unknown> = {}) {
    calls.push({ kind: 'rpc', name, args })
    const handler = fixtures.rpc[name]
    try {
      return Promise.resolve(result(handler ? handler(args) : []))
    } catch (failure) {
      return Promise.resolve(result(null, { message: failure instanceof Error ? failure.message : String(failure) }))
    }
  },

  functions: {
    async invoke(name: string, options: { body?: Record<string, unknown> } = {}) {
      calls.push({ kind: 'function', name, args: options.body })
      const handler = fixtures.functions[name]
      const answer = handler ? handler(options.body ?? {}) : { data: null }
      return { data: answer.data ?? null, error: answer.error ?? null }
    }
  },

  channel: () => channel,
  removeChannel: () => Promise.resolve('ok'),

  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    refreshSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange(listener: (event: string, session: unknown) => void) {
      authListener = listener
      return { data: { subscription: { unsubscribe: () => (authListener = null) } } }
    },
    async signOut() {
      fixtures.user = null
      authListener?.('SIGNED_OUT', null)
      return { error: null }
    },
    signInWithOtp: async () => ({ data: {}, error: null }),
    signInWithPassword: async () => ({ data: {}, error: null }),
    signUp: async () => ({ data: {}, error: null })
  }
}
