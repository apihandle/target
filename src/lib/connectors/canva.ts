import { z } from "zod";
import { defineConnector, tool } from "@/lib/connectors/define";
import { apiFetch, ConnectorError } from "@/lib/connectors/http";
import type { ToolContext } from "@/lib/connectors/types";

/**
 * Canva, via the Canva Connect REST API (OAuth 2.0 + PKCE), https://www.canva.dev/docs/connect/api-reference/.
 *
 * The Canva MCP server (https://mcp.canva.com/mcp for waitlist clients, https://api.canva.com/connect/v1/mcp
 * for Developer Portal apps) also requires a registered Developer Portal app with a client id/secret.
 * Since that registration is needed either way, this connector calls the documented REST endpoints
 * directly, which keeps every call inside TARGET's approval / redaction pipeline.
 * Exports, asset uploads and autofills are asynchronous jobs: start, then poll until success/failed.
 */
const API = "https://api.canva.com/rest/v1";
type Json = Record<string, unknown>;
const call = <T = Json>(ctx: ToolContext, path: string, init: Parameters<typeof apiFetch>[1] = {}) =>
  apiFetch<T>(`${API}${path}`, { ...init, f: ctx.fetch, headers: { Authorization: `Bearer ${ctx.token}` } });

const canvaId = (what: string) => z.string().min(3).max(100).regex(/^[A-Za-z0-9_-]+$/, `A Canva ${what} id`);
const designId = canvaId("design").describe("Design id (e.g. DAFVztcvd9z), from list_designs or a canva.com/design/<id>/ URL").or(
  z.string().max(500).transform((s) => s.match(/canva\.com\/design\/([A-Za-z0-9_-]+)/)?.[1] ?? "").pipe(canvaId("design")),
);

/** Poll an async job until it finishes (about 15 s), then report in_progress with the job id. */
type Job = { id?: string; status?: string; error?: { code?: string; message?: string } } & Json;
async function waitJob(ctx: ToolContext, start: Job | undefined, path: (id: string) => string, pollMs = 1500, tries = 10): Promise<Job> {
  let job = start ?? {};
  if (!job.id) throw new ConnectorError("Canva didn't start the job.", 502);
  for (let i = 0; i < tries && job.status === "in_progress"; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
    job = (await call<{ job?: Job }>(ctx, path(job.id!))).job ?? job;
  }
  if (job.status === "failed") throw new ConnectorError(`Canva: ${job.error?.message ?? job.error?.code ?? "the job failed"}`, 400, "invalid");
  return job;
}
type Design = { id?: string; title?: string; updated_at?: number; page_count?: number; urls?: { edit_url?: string; view_url?: string }; thumbnail?: { url?: string } };
const sec = (n?: number) => (typeof n === "number" ? new Date(n * 1000).toISOString() : undefined);
const designOut = (d: Design = {}) => ({ id: d.id, title: d.title, updated_at: sec(d.updated_at), pages: d.page_count, edit_url: d.urls?.edit_url, view_url: d.urls?.view_url });

export const canva = defineConnector({
  id: "canva",
  name: "Canva",
  icon: "C",
  description: "Find your designs and folders, start new designs, export them, upload images to your Canva library, and fill brand templates with your content.",
  auth: "oauth",
  scopes: [
    "profile:read", "design:meta:read", "design:content:read", "design:content:write",
    "asset:read", "asset:write", "folder:read", "brandtemplate:meta:read", "brandtemplate:content:read",
  ],
  capabilities: [
    "List and search your designs; browse folders",
    "Create a new doc, whiteboard, presentation or custom-size design",
    "Export a design as PDF, PNG, JPG, GIF, PPTX or MP4",
    "Upload an image or video to your Canva library from a public URL",
    "List brand templates, see their fields and autofill them into a new design (Canva Pro / Teams / Enterprise)",
  ],
  permissions: [
    "design:meta:read / design:content:read / design:content:write: see, export and create designs.",
    "asset:read / asset:write: upload images and videos to your library. folder:read: browse folders.",
    "brandtemplate:meta:read / brandtemplate:content:read: list brand templates and their fields for autofill. profile:read: your display name.",
    "TARGET can't delete designs. Revoke access in Canva → Settings → Integrations.",
  ],
  requiredEnv: ["CANVA_OAUTH_CLIENT_ID", "CANVA_OAUTH_CLIENT_SECRET"],
  oauth: {
    authorizeUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: `${API}/oauth/token`,
    clientIdEnv: "CANVA_OAUTH_CLIENT_ID",
    clientSecretEnv: "CANVA_OAUTH_CLIENT_SECRET",
    tokenAuth: "basic",
    pkce: true,
    refreshable: true,
    async accountLabel(token, _j, f) {
      const p = await apiFetch<{ profile?: { display_name?: string } }>(`${API}/users/me/profile`, { f, headers: { Authorization: `Bearer ${token}` } });
      return p.profile?.display_name ?? "";
    },
    async revoke(creds, env, f) {
      const id = env.CANVA_OAUTH_CLIENT_ID, secret = env.CANVA_OAUTH_CLIENT_SECRET;
      if (!id || !secret) return;
      await f(`${API}/oauth/revoke`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: creds.refresh_token ?? creds.access_token }).toString(),
      }).catch(() => undefined);
    },
  },
  docs: [
    "https://www.canva.dev/docs/connect/authentication/", "https://www.canva.dev/docs/connect/api-reference/",
    "https://www.canva.dev/docs/connect/api-reference/designs/list-designs/", "https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/",
    "https://www.canva.dev/docs/connect/api-reference/assets/create-url-asset-upload-job/", "https://www.canva.dev/docs/connect/api-reference/folders/list-folder-items/",
    "https://www.canva.dev/docs/connect/api-reference/brand-templates/list-brand-templates/", "https://www.canva.dev/docs/connect/api-reference/autofills/create-design-autofill-job/",
    "https://www.canva.dev/docs/mcp",
  ],
  todo: ["Owner: create the Canva integration (scopes listed above) and set CANVA_OAUTH_CLIENT_ID / CANVA_OAUTH_CLIENT_SECRET."],
  getTools: () => [
    tool({
      name: "list_designs",
      description: "List or search the user's Canva designs (newest first).",
      input: z.object({ query: z.string().max(200).optional(), ownership: z.enum(["any", "owned", "shared"]).default("any"), limit: z.number().int().min(1).max(200).default(25) }),
      async execute(a, ctx) {
        const out: Design[] = [];
        let continuation: string | undefined;
        while (out.length < a.limit) {
          const q = new URLSearchParams({ ownership: a.ownership, sort_by: "modified_descending" });
          if (a.query) q.set("query", a.query);
          if (continuation) q.set("continuation", continuation);
          const j = await call<{ items?: Design[]; continuation?: string }>(ctx, `/designs?${q}`);
          out.push(...(j.items ?? []));
          continuation = j.continuation;
          if (!continuation) break;
        }
        return out.slice(0, a.limit).map(designOut);
      },
    }),
    tool({
      name: "create_design",
      description: "Create a new Canva design: a preset (doc, whiteboard, presentation) or a custom size in pixels, optionally starting with an uploaded image asset.",
      input: z.object({
        title: z.string().min(1).max(255), type: z.enum(["doc", "whiteboard", "presentation", "custom"]).default("presentation"),
        width: z.number().int().min(40).max(8000).optional(), height: z.number().int().min(40).max(8000).optional(), asset_id: canvaId("asset").optional(),
      }).refine((a) => a.type !== "custom" || (a.width && a.height), "A custom design needs width and height"),
      async execute(a, ctx) {
        const design_type = a.type === "custom" ? { type: "custom", width: a.width, height: a.height } : { type: "preset", name: a.type };
        const j = await call<{ design?: Design }>(ctx, "/designs", { method: "POST", body: { design_type, title: a.title, ...(a.asset_id ? { asset_id: a.asset_id } : {}) } });
        return designOut(j.design);
      },
    }),
    tool({
      name: "export_design",
      description: "Export a design and return temporary download URLs (valid ~24 hours). Optional page numbers.",
      input: z.object({ design_id: designId, format: z.enum(["pdf", "png", "jpg", "gif", "pptx", "mp4"]).default("pdf"), pages: z.array(z.number().int().min(1)).max(100).optional() }),
      async execute(a, ctx) {
        const format: Json = { type: a.format, ...(a.pages?.length ? { pages: a.pages } : {}), ...(a.format === "jpg" ? { quality: 90 } : {}), ...(a.format === "mp4" ? { quality: "horizontal_1080p" } : {}) };
        const start = await call<{ job?: Job }>(ctx, "/exports", { method: "POST", body: { design_id: a.design_id, format } });
        const job = await waitJob(ctx, start.job, (id) => `/exports/${encodeURIComponent(id)}`);
        if (job.status === "success") return { status: "success", urls: job.urls };
        return { status: "in_progress", job_id: job.id, note: "Export still running; ask again shortly." };
      },
    }),
    tool({
      name: "upload_asset",
      description: "Upload an image or video into the user's Canva library from a public URL (Canva fetches it). Returns the asset id for create_design or autofill.",
      input: z.object({ name: z.string().min(1).max(50), url: z.string().url().max(2048).refine((u) => /^https:\/\//i.test(u), "Use an https:// URL") }),
      async execute(a, ctx) {
        const start = await call<{ job?: Job }>(ctx, "/url-asset-uploads", { method: "POST", body: { name: a.name, url: a.url } });
        const job = await waitJob(ctx, start.job, (id) => `/url-asset-uploads/${encodeURIComponent(id)}`);
        const asset = job.asset as { id?: string; name?: string; type?: string; thumbnail?: { url?: string } } | undefined;
        if (job.status === "success") return { status: "success", asset_id: asset?.id, name: asset?.name, type: asset?.type };
        return { status: "in_progress", job_id: job.id, note: "Upload still processing; ask again shortly." };
      },
    }),
    tool({
      name: "list_folders",
      description: "Browse Canva folders: list a folder's subfolders, designs and images (folder_id 'root' for the top level).",
      input: z.object({ folder_id: z.string().max(100).regex(/^[A-Za-z0-9_-]+$/).default("root"), item_types: z.array(z.enum(["folder", "design", "image"])).min(1).default(["folder", "design"]), limit: z.number().int().min(1).max(200).default(50) }),
      async execute(a, ctx) {
        const items: Json[] = [];
        let continuation: string | undefined;
        while (items.length < a.limit) {
          const q = new URLSearchParams({ item_types: a.item_types.join(","), sort_by: "modified_descending" });
          if (continuation) q.set("continuation", continuation);
          const j = await call<{ items?: ({ type?: string } & Json)[]; continuation?: string }>(ctx, `/folders/${encodeURIComponent(a.folder_id)}/items?${q}`);
          for (const it of j.items ?? []) {
            const t = String(it.type);
            const v = (it[t] ?? {}) as Json & Design & { name?: string };
            items.push(t === "design" ? { type: t, ...designOut(v) } : { type: t, id: v.id, name: v.name ?? v.title, updated_at: sec(v.updated_at) });
          }
          continuation = j.continuation;
          if (!continuation) break;
        }
        return { folder_id: a.folder_id, items: items.slice(0, a.limit) };
      },
    }),
    tool({
      name: "list_brand_templates",
      description: "List brand templates the user can use (Canva Pro/Teams/Enterprise), optionally only those that support autofill.",
      input: z.object({ query: z.string().max(200).optional(), autofill_only: z.boolean().default(true), limit: z.number().int().min(1).max(100).default(25) }),
      async execute(a, ctx) {
        const q = new URLSearchParams({ sort_by: "modified_descending", ...(a.autofill_only ? { dataset: "non_empty" } : {}) });
        if (a.query) q.set("query", a.query);
        const j = await call<{ items?: { id?: string; title?: string; view_url?: string; create_url?: string; updated_at?: number }[] }>(ctx, `/brand-templates?${q}`);
        return (j.items ?? []).slice(0, a.limit).map((t) => ({ id: t.id, title: t.title, updated_at: sec(t.updated_at), view_url: t.view_url }));
      },
    }),
    tool({
      name: "get_brand_template_fields",
      description: "Show the autofill fields of a brand template (name → text / image / chart).",
      input: z.object({ brand_template_id: canvaId("brand template") }),
      async execute(a, ctx) {
        const j = await call<{ dataset?: Record<string, { type?: string }> }>(ctx, `/brand-templates/${a.brand_template_id}/dataset`);
        return { fields: Object.fromEntries(Object.entries(j.dataset ?? {}).map(([k, v]) => [k, v.type])) };
      },
    }),
    tool({
      name: "autofill_brand_template",
      description: "Create a new design from a brand template, filling its fields: text values as strings, images as { asset_id } (from upload_asset). Needs Canva Pro/Teams/Enterprise.",
      input: z.object({
        brand_template_id: canvaId("brand template"), title: z.string().min(1).max(255).optional(),
        fields: z.record(z.string(), z.union([z.string().max(10000), z.object({ asset_id: canvaId("asset") }), z.object({ chart_data: z.record(z.string(), z.unknown()) })])),
      }).refine((a) => Object.keys(a.fields).length > 0, "Give at least one field"),
      async execute(a, ctx) {
        const ds = await call<{ dataset?: Record<string, { type?: string }> }>(ctx, `/brand-templates/${a.brand_template_id}/dataset`);
        const schema = ds.dataset ?? {};
        if (!Object.keys(schema).length) throw new ConnectorError("This brand template has no autofill fields.", 400, "invalid");
        const data: Json = {};
        for (const [k, v] of Object.entries(a.fields)) {
          const type = schema[k]?.type;
          if (!type) throw new ConnectorError(`"${k}" isn't a field of this template. Fields: ${Object.keys(schema).join(", ")}`.slice(0, 380), 400, "invalid");
          if (type === "text") data[k] = { type: "text", text: typeof v === "string" ? v : JSON.stringify(v) };
          else if (type === "image") { if (typeof v === "string" || !("asset_id" in v)) throw new ConnectorError(`"${k}" is an image field: give { asset_id } from upload_asset.`, 400, "invalid"); data[k] = { type: "image", asset_id: v.asset_id }; }
          else if (type === "chart") { if (typeof v === "string" || !("chart_data" in v)) throw new ConnectorError(`"${k}" is a chart field: give { chart_data }.`, 400, "invalid"); data[k] = { type: "chart", chart_data: v.chart_data }; }
          else throw new ConnectorError(`"${k}" (${type}) can't be autofilled here.`, 400, "invalid");
        }
        const start = await call<{ job?: Job }>(ctx, "/autofills", { method: "POST", body: { type: "create_from_brand_template", brand_template_id: a.brand_template_id, data, ...(a.title ? { title: a.title } : {}) } });
        const job = await waitJob(ctx, start.job, (id) => `/autofills/${encodeURIComponent(id)}`);
        if (job.status === "success") return { status: "success", design: designOut((job.result as { design?: Design } | undefined)?.design) };
        return { status: "in_progress", job_id: job.id, note: "Autofill still running; ask again shortly." };
      },
    }),
  ],
});
