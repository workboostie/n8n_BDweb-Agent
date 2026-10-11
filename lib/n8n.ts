import "server-only";
import type { Post } from "./posts";

export const POSTS_TABLE = "Wpb1eKfThKPzRimw";
export const PROFILE_TABLE = "D598KQIlkg9joecY";
export const EXAMPLES_TABLE = "g8qX0fDQVwQCl42A";
export const STYLE_VERSIONS_TABLE = "6LYrHxupc2tXtAdE";

export type WritingExample = {
  id: number;
  post_key: string;
  fmt: string;
  pillar: string;
  ai_caption: string;
  final_caption: string;
  edited: boolean;
  change_pct: number;
  feedback: string;
  learned_version: number | null;
  createdAt: string;
};

export type StyleVersion = {
  id: number;
  version: number;
  source: string;
  style_guide: string;
  changes: string;
  learned_from: string;
  assistant_note: string;
  createdAt: string;
};

export type RowFilter = { columnName: string; condition: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "like"; value: unknown };

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env("N8N_BASE_URL").replace(/\/$/, "")}/api/v1${path}`, {
    ...init,
    headers: { "X-N8N-API-KEY": env("N8N_API_KEY"), "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`n8n API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export async function getRows<T>(table: string, filters: RowFilter[] = []): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const q = new URLSearchParams({ limit: "250" });
    if (filters.length) q.set("filter", JSON.stringify({ type: "and", filters }));
    if (cursor) q.set("cursor", cursor);
    const r: { data: T[]; nextCursor: string | null } = await api(`/data-tables/${table}/rows?${q}`);
    out.push(...r.data);
    cursor = r.nextCursor;
  } while (cursor);
  return out;
}

export async function updateRows(table: string, filters: RowFilter[], data: Record<string, unknown>) {
  return api(`/data-tables/${table}/rows/update`, {
    method: "PATCH",
    body: JSON.stringify({ filter: { type: "and", filters }, data }),
  });
}

export async function insertRows(table: string, rows: Record<string, unknown>[]) {
  return api(`/data-tables/${table}/rows`, {
    method: "POST",
    body: JSON.stringify({ data: rows, returnType: "count" }),
  });
}

export async function getPosts() {
  return getRows<Post>(POSTS_TABLE);
}

export async function getExamples() {
  const rows = await getRows<WritingExample>(EXAMPLES_TABLE);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getStyleVersions() {
  const rows = await getRows<StyleVersion>(STYLE_VERSIONS_TABLE);
  return rows.sort((a, b) => b.version - a.version);
}

export async function getConfig() {
  const rows = await getRows<{ key: string; value: string }>(PROFILE_TABLE);
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>;
}

export async function setConfig(values: Record<string, string>) {
  const current = await getConfig();
  for (const [key, value] of Object.entries(values)) {
    if (key in current) await updateRows(PROFILE_TABLE, [{ columnName: "key", condition: "eq", value: key }], { value });
    else await insertRows(PROFILE_TABLE, [{ key, value }]);
  }
}

export async function callDashboardApi<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}) {
  const res = await fetch(env("DASHBOARD_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dashboard-secret": env("DASHBOARD_SECRET") },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
  const text = await res.text();
  let json: { ok?: boolean; error?: string } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(res.ok ? "Unexpected response from n8n" : `n8n error ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `n8n error ${res.status}`);
  return json;
}

export async function fetchImage(fileId: string) {
  return fetch(env("DASHBOARD_WEBHOOK_URL"), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-dashboard-secret": env("DASHBOARD_SECRET") },
    body: JSON.stringify({ action: "image", file_id: fileId }),
    cache: "no-store",
  });
}
