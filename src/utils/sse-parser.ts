/**
 * Splits a server-sent event stream into the `data` of each complete event.
 *
 * Network chunks do not line up with events: a proxy (for example Cloud Run's
 * front end) can deliver one event and the start of the next in one chunk.
 * Only events that have their closing blank line are returned; the rest stays
 * buffered until the next chunk, so each event is returned exactly once.
 */
export class SseDataParser {
  private buffer = '';

  /** Adds a decoded chunk and returns the data of the events it completed. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const blocks = this.buffer.split(/\r?\n\r?\n/);
    this.buffer = blocks.pop() ?? '';
    return blocks.flatMap(dataOf);
  }

  /** Returns the data of an event left without its closing blank line. */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = '';
    return dataOf(rest);
  }
}

/** The JSON data of one event block, or nothing if it has none. */
function dataOf(block: string): string[] {
  const lines = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data: ?/, ''));
  if (lines.length === 0) {
    return [];
  }
  const data = lines.join('\n');
  try {
    JSON.parse(data);
  } catch {
    console.warn('Ignored a server-sent event that is not JSON', data);
    return [];
  }
  return [data];
}
