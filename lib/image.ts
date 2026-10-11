export const IMAGE_RATIO = 5 / 3;

export async function compressImage(file: File, maxWidth = 1500, quality = 0.88): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > IMAGE_RATIO) sw = Math.round(sh * IMAGE_RATIO);
  else sh = Math.round(sw / IMAGE_RATIO);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);
  const width = Math.min(maxWidth, sw);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width / IMAGE_RATIO);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  return blob ?? file;
}
