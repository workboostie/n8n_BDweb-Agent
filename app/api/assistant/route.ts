import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runAgent, type AgentStep, type ChatMsg } from "@/lib/agent";

export const maxDuration = 300;

const READ_TOOLS = ["list_posts", "get_post", "get_settings"];

function finish(steps: AgentStep[]) {
  if (steps.some((s) => s.ok && !READ_TOOLS.includes(s.tool))) revalidatePath("/", "layout");
  return steps.filter((s) => !READ_TOOLS.includes(s.tool)).map((s) => ({ ok: s.ok, tool: s.tool, text: s.result }));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { messages?: ChatMsg[]; text?: string; stream?: boolean };
  const raw: ChatMsg[] = Array.isArray(body.messages) ? body.messages : body.text ? [{ from: "me", text: String(body.text) }] : [];
  const history = raw
    .filter((m) => m && (m.from === "me" || m.from === "ai") && typeof m.text === "string" && m.text.trim())
    .slice(-16);
  if (!history.length || history[history.length - 1].from !== "me") {
    return NextResponse.json({ ok: false, error: "Write a message first" }, { status: 400 });
  }

  if (!body.stream) {
    try {
      const { reply, steps } = await runAgent(history);
      return NextResponse.json({ ok: true, reply, steps: finish(steps) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const { reply, steps } = await runAgent(history, send);
        send({ type: "done", ok: true, reply, steps: finish(steps) });
      } catch (e) {
        send({ type: "done", ok: false, error: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
