/**
 * Turns a picked image file into a small square `data:` URL.
 *
 * The photo is stored on the user's own row (the desktop edition ships one
 * SQLite file and no blob store), so it is re-encoded here rather than sent as
 * picked: a 4MB camera JPEG would otherwise ride along with every user read.
 * Centre-cropped to a square first, because an avatar is drawn in a circle and
 * a letterboxed portrait loses the face.
 */
export async function squarePhotoDataUrl(file: File, size: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
