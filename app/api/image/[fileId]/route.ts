import { fetchImage } from "@/lib/n8n";

export async function GET(_req: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!/^[\w-]{10,200}$/.test(fileId)) return new Response("Bad file id", { status: 400 });
  const res = await fetchImage(fileId);
  if (!res.ok || !res.body) return new Response("Image not available", { status: 502 });
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, max-age=604800, immutable",
    },
  });
}
