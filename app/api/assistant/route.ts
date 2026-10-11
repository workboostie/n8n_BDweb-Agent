import { NextResponse } from "next/server";
import { callDashboardApi } from "@/lib/n8n";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const { text } = (await req.json().catch(() => ({}))) as { text?: string };
    const msg = String(text || "").trim();
    if (!msg) return NextResponse.json({ ok: false, error: "Write a message first" }, { status: 400 });
    const r = await callDashboardApi<{ reply?: string }>("coach", { mode: "chat", text: msg });
    return NextResponse.json({ ok: true, reply: r.reply || "Done." });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
