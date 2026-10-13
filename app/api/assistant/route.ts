import { NextResponse } from "next/server";
import { planTurn, type ChatMsg } from "@/lib/agent";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMsg[]; text?: string; running?: unknown };
  const raw: ChatMsg[] = Array.isArray(body.messages) ? body.messages : body.text ? [{ from: "me", text: String(body.text) }] : [];
  const history = raw
    .filter((m) => m && (m.from === "me" || m.from === "ai") && typeof m.text === "string" && m.text.trim())
    .slice(-16);
  if (!history.length || history[history.length - 1].from !== "me") {
    return NextResponse.json({ ok: false, error: "Write a message first" }, { status: 400 });
  }
  const running = Array.isArray(body.running) ? body.running.map(String).slice(0, 40) : [];
  try {
    const { reply, tasks } = await planTurn(history, running);
    return NextResponse.json({ ok: true, reply, tasks });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
