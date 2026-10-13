import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runTask } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { tool?: string; args?: Record<string, unknown> };
  const tool = String(body.tool || "");
  const args = body.args && typeof body.args === "object" ? body.args : {};
  try {
    const text = await runTask(tool, args);
    revalidatePath("/", "layout");
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error, retryable: /unavailable|overload|503|429|too many|timed? ?out|fetch failed/i.test(error) });
  }
}
