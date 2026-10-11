import { NextResponse } from "next/server";
import { callDashboardApi } from "@/lib/n8n";

export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const postKey = String(form.get("post_key") || "");
    const file = form.get("file");
    if (!postKey || !(file instanceof Blob)) return NextResponse.json({ ok: false, error: "post_key and file are required" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "Image is larger than 4 MB" }, { status: 413 });
    if (!/^image\//.test(file.type)) return NextResponse.json({ ok: false, error: "Only images can be uploaded" }, { status: 400 });
    const image_base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const r = await callDashboardApi("upload_image", { post_key: postKey, image_base64, mime: file.type });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
