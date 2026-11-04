/* eslint-disable @typescript-eslint/no-unused-vars */
/* In-memory stand-in for the Supabase client, used to test route handlers end to end.
 * It simulates row-level security (rows are only visible to their user_id owner) and
 * the approval_requests guard trigger from migration 0006. */
import { randomUUID } from "crypto";
import { canMoveApproval, type ApprovalStatus } from "@/lib/approvals";

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  uid: string | null = null;
  /** Service-role view: bypasses RLS and column grants. */
  bypass = false;
  rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  rpcResult: unknown = true;
  constructor(seed: Record<string, Row[]> = {}) { for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r })); }
  /** A service-role client over the same tables (like createAdminClient()). */
  private parent: FakeDb | null = null;
  admin() { const a = new FakeDb(); a.tables = this.tables; a.bypass = true; a.parent = this; return a; }
  async rpc(fn: string, args: Record<string, unknown>) { const root = this.parent ?? this; root.rpcCalls.push({ fn, args }); return { data: root.rpcResult, error: null }; }
  as(uid: string | null) { this.uid = uid; return this; }
  rows(t: string) { return (this.tables[t] ??= []); }
  get auth() { return { getUser: async () => ({ data: { user: this.uid ? { id: this.uid, email: `${this.uid}@x.test`, user_metadata: {}, app_metadata: {} } : null } }) }; }
  from(table: string) { return new Query(this, table); }
  /** Storage objects by "bucket/path". Simulates migration 0008's policy: a user only sees "<own uid>/..." keys. */
  files: Record<string, Uint8Array> = {};
  get storage() {
    const root = this.parent ?? this;
    const own = (path: string) => this.bypass || (!!this.uid && path.split("/")[0] === this.uid);
    return {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (!own(path)) return { data: null, error: { message: "new row violates row-level security policy" } };
          root.files[`${bucket}/${path}`] = bytes; return { data: { path }, error: null };
        },
        download: async (path: string) => {
          const b = own(path) ? root.files[`${bucket}/${path}`] : undefined;
          if (!b) return { data: null, error: { message: "Object not found" } };
          return { data: { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, error: null };
        },
        remove: async (paths: string[]) => { for (const p of paths) if (own(p)) delete root.files[`${bucket}/${p}`]; return { data: [], error: null }; },
      }),
    };
  }
}

const DEFAULTS: Record<string, Row> = {
  tasks: { status: "queued", notes: "", progress: "", error: null, origin: "user", project_id: null, conversation_id: null },
  approval_requests: { status: "pending", decided_by: null, decided_at: null, executed_at: null, result: null, error: null, project_id: null, conversation_id: null, task_id: null, destination: "" },
  projects: { instructions: "", description: "", status: "active", archived_at: null },
  activity_events: { detail: "", status: null, project_id: null, task_id: null, approval_id: null },
  panels: { description: "", items: [], data: null, error: null, refreshed_at: null, position: 0 },
};

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private filters: Filter[] = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private returning = false;
  private mode: "one" | "maybe" | null = null;
  private countMode = false; private head = false;
  private lim = Infinity;
  constructor(private db: FakeDb, private table: string) {}
  private cols = "";
  private conflict = "";
  private visible(r: Row) { return this.db.bypass || !("user_id" in r) || r.user_id === this.db.uid || this.table === "__admin"; }
  select(cols?: string, opts?: { count?: string; head?: boolean }) { this.cols = cols ?? "*"; if (this.op === "select") { this.countMode = !!opts?.count; this.head = !!opts?.head; } else this.returning = true; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) { this.op = "upsert"; this.payload = p; this.conflict = opts?.onConflict ?? ""; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  eq(k: string, v: unknown) { this.filters.push((r) => r[k] === v); return this; }
  neq(k: string, v: unknown) { this.filters.push((r) => r[k] !== v); return this; }
  in(k: string, v: unknown[]) { this.filters.push((r) => v.includes(r[k])); return this; }
  lte(k: string, v: string) { this.filters.push((r) => r[k] != null && String(r[k]) <= v); return this; }
  lt(k: string, v: string) { this.filters.push((r) => r[k] != null && String(r[k]) < v); return this; }
  gte(k: string, v: string) { this.filters.push((r) => r[k] != null && String(r[k]) >= v); return this; }
  is(k: string, v: unknown) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  ilike(k: string, pattern: string) {
    // Translate a SQL ILIKE pattern (with \ escapes) into a case-insensitive regex.
    let re = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "\\" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
      re += c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    const rx = new RegExp(`^${re}$`, "is");
    this.filters.push((r) => typeof r[k] === "string" && rx.test(r[k] as string));
    return this;
  }
  not(k: string, _op: string, _v: unknown) { this.filters.push((r) => r[k] != null); return this; }
  order() { return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "one"; return this; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then<A = any, B = never>(ok?: ((v: any) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) { return Promise.resolve(this.run()).then(ok, bad); }
  private run(): { data: unknown; error: { message: string } | null; count?: number } {
    // Simulates migration 0007's column grants: browser roles can't read connections.encrypted_credentials,
    // can't insert/update connections, and can't touch the server-only tables at all.
    if (!this.db.bypass) {
      if (this.table === "connections" && (this.cols === "*" || /encrypted_credentials/.test(this.cols))) return { data: null, error: { message: "permission denied for column encrypted_credentials" } };
      if (this.table === "connections" && (this.op === "insert" || this.op === "upsert" || this.op === "update")) return { data: null, error: { message: "permission denied for table connections" } };
      // Migration 0016: custom_providers.key_box is never readable by browser roles; writes are server-only.
      if (this.table === "custom_providers" && (this.cols === "*" || /key_box/.test(this.cols))) return { data: null, error: { message: "permission denied for column key_box" } };
      if (this.table === "custom_providers" && (this.op === "insert" || this.op === "upsert" || this.op === "update")) return { data: null, error: { message: "permission denied for table custom_providers" } };
      if (["connection_secrets", "connector_oauth_states", "connector_rate_limits"].includes(this.table)) return { data: null, error: { message: `permission denied for table ${this.table}` } };
    }
    const all = this.db.rows(this.table);
    const match = () => all.filter((r) => this.visible(r) && this.filters.every((f) => f(r)));
    // custom_providers: return only the selected columns, like PostgREST (so tests can check key_box never leaves).
    const project = (rows: Row[]) => this.table !== "custom_providers" || !this.cols || this.cols === "*" ? rows
      : rows.map((r) => Object.fromEntries(this.cols.split(",").map((c) => c.trim()).filter(Boolean).map((c) => [c, r[c]])));
    const finish = (raw: Row[]) => {
      const rows = project(raw);
      if (this.mode === "one") return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: "not single" } };
      if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    if (this.op === "select") {
      const rows = match().slice(0, this.lim);
      if (this.countMode) return { data: this.head ? null : rows, error: null, count: rows.length };
      return finish(rows);
    }
    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload!];
      const out: Row[] = [];
      for (const p of list) {
        if (!this.db.bypass && "user_id" in p && p.user_id !== this.db.uid) return { data: null, error: { message: "RLS: user_id mismatch" } };
        if (this.table === "approval_requests" && p.status !== "pending") return { data: null, error: { message: "RLS: must start pending" } };
        const keys = this.conflict ? this.conflict.split(",") : [this.table === "user_settings" ? "user_id" : "id"];
        const existing = this.op === "upsert" ? all.find((r) => keys.every((k) => r[k] === p[k])) : undefined;
        if (existing) { Object.assign(existing, p); out.push(existing); continue; }
        const row = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(DEFAULTS[this.table] ?? {}), ...p };
        all.push(row); out.push(row);
      }
      return this.returning ? finish(out) : { data: null, error: null };
    }
    if (this.op === "update") {
      const rows = match();
      const p = this.payload as Row;
      for (const r of rows) {
        if (this.table === "approval_requests") {
          for (const k of ["user_id", "action_type", "payload", "summary", "destination"]) if (k in p && JSON.stringify(p[k]) !== JSON.stringify(r[k])) return { data: null, error: { message: "immutable" } };
          if (p.status && p.status !== r.status) {
            if (!canMoveApproval(r.status as ApprovalStatus, p.status as ApprovalStatus)) return { data: null, error: { message: `invalid transition ${r.status} -> ${p.status}` } };
            if (["approved", "rejected", "cancelled"].includes(p.status as string)) { r.decided_by = this.db.uid ?? (p.status === "approved" && p.auto ? r.user_id : null); r.decided_at = new Date().toISOString(); }
          }
          const { decided_by: _a, decided_at: _b, ...rest } = p; void _a; void _b;
          Object.assign(r, rest);
        } else Object.assign(r, p);
      }
      return this.returning ? finish(rows) : { data: null, error: null };
    }
    const rows = match();
    this.db.tables[this.table] = all.filter((r) => !rows.includes(r));
    return this.returning ? finish(rows) : { data: null, error: null };
  }
}
