/** Read image SSE without ever treating an unfinished preview as the result. */
export async function readImageStream(response: Response, onPreview: (image: string, index: number) => void, requestedFormat: 'png'|'jpeg'|'webp' = 'png') {
  if (!response.body) throw new Error('OpenAI image stream has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let bytes = 0;
  let received = 0;
  const consume = (block: string) => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return;
    const event = JSON.parse(data);
    if (event.type === 'error' || event.error) throw new Error(event.error?.message || event.message || 'OpenAI image stream failed');
    if (!['image_generation.partial_image', 'image_edit.partial_image', 'image_generation.completed', 'image_edit.completed'].includes(event.type)) return;
    if (typeof event.b64_json !== 'string' || !event.b64_json) throw new Error('OpenAI image event has no image');
    const format = ['png', 'jpeg', 'webp'].includes(event.output_format) ? event.output_format : requestedFormat;
    if (event.type.endsWith('.partial_image')) {
      const index = Number.isInteger(event.partial_image_index) && event.partial_image_index >= 0
        ? event.partial_image_index : received;
      received++;
      onPreview(`data:image/${format};base64,${event.b64_json}`, index);
      return;
    }
    return {data: [{b64_json: event.b64_json}], usage: event.usage};
  };
  try {
    while (true) {
      const {done, value} = await reader.read();
      bytes += value?.byteLength ?? 0;
      if (bytes > 64 * 1024 * 1024) throw new Error('OpenAI image stream exceeded size limit');
      buffer += decoder.decode(value, {stream: !done});
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const result = consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (result) return result;
      }
      if (done) {
        const result = consume(buffer);
        if (result) return result;
        throw new Error('OpenAI image stream ended before the final image');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
