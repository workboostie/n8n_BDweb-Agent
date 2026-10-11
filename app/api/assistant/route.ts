import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runAgent, type ChatMsg } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { messages?: ChatMsg[]; text?: string };
    const raw: ChatMsg[] = Array.isArray(body.messages) ? body.messages : body.text ? [{ from: "me", text: String(body.text) }] : [];
    const history = raw
      .filter((m) => m && (m.from === "me" || m.from === "ai") && typeof m.text === "string" && m.text.trim())
      .slice(-16);
    if (!history.length || history[history.length - 1].from !== "me") {
      return NextResponse.json({ ok: false, error: "Write a message first" }, { status: 400 });
    }
    const { reply, steps } = await runAgent(history);
    if (steps.some((s) => s.ok && !["list_posts", "get_post", "get_settings"].includes(s.tool))) revalidatePath("/", "layout");
    return NextResponse.json({
      ok: true,
      reply,
      steps: steps.filter((s) => !["list_posts", "get_post", "get_settings"].includes(s.tool)).map((s) => ({ ok: s.ok, text: s.result })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
