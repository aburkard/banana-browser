// Reference photos are rendered as thumbnails, and GPT Image bills them by pixel area:
// on October 17, five ESPN photos cost 4,399 input tokens at their original ~600 px
// but 1,008 at 256 px, cutting a GPT Image 2.5 Flare page from $0.045 to $0.021
// with the same result. Gemini bills a fixed 1,120 tokens per image, so smaller
// photos there only shorten the upload. Site layout screenshots keep more detail.
export const PHOTO_MAX_SIDE = 256;
export const LAYOUT_MAX_SIDE = 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** A data URL for the image, downscaled to fit maxSide as JPEG where the browser can; otherwise unchanged. */
export async function shrinkImage(bytes: Uint8Array, mimeType: string, maxSide: number): Promise<{dataUrl: string; mimeType: string}> {
  const original = {dataUrl: `data:${mimeType};base64,${toBase64(bytes)}`, mimeType};
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return original;
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], {type: mimeType}));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) { bitmap.close(); return original; }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); return original; }
    // JPEG has no transparency; a white backdrop keeps transparent logos from turning black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.85});
    return {dataUrl: `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`, mimeType: 'image/jpeg'};
  } catch {
    return original;
  }
}
