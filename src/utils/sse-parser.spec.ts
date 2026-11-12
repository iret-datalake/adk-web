import {SseDataParser} from './sse-parser';

const event = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

describe('SseDataParser', () => {
  const first = event({id: 'step'});
  const second = event({id: 'input', schema: {type: 'object'}});
  const stream = first + second;

  function parseInChunks(chunks: string[]): string[] {
    const parser = new SseDataParser();
    const ids = chunks.flatMap((chunk) => parser.push(chunk));
    ids.push(...parser.flush());
    return ids.map((data) => JSON.parse(data).id);
  }

  it('returns events that arrive one per chunk', () => {
    expect(parseInChunks([first, second])).toEqual(['step', 'input']);
  });

  it('returns each event once when a chunk ends inside the next event', () => {
    const cut = first.length + 10;
    expect(parseInChunks([stream.slice(0, cut), stream.slice(cut)]))
        .toEqual(['step', 'input']);
  });

  it('returns each event once whatever the chunk size', () => {
    for (let size = 1; size <= stream.length; size++) {
      const chunks = [];
      for (let i = 0; i < stream.length; i += size) {
        chunks.push(stream.slice(i, i + size));
      }
      expect(parseInChunks(chunks)).withContext(`size ${size}`)
          .toEqual(['step', 'input']);
    }
  });

  it('handles CRLF line endings split across chunks', () => {
    const crlf = stream.replace(/\n/g, '\r\n');
    const cut = crlf.indexOf('\r\n\r\n') + 1;
    expect(parseInChunks([crlf.slice(0, cut), crlf.slice(cut)]))
        .toEqual(['step', 'input']);
  });

  it('returns a last event that has no closing blank line', () => {
    expect(parseInChunks([first, 'data: {"id": "last"}'])).toEqual(['step', 'last']);
  });

  it('skips events whose data is not JSON', () => {
    spyOn(console, 'warn');
    expect(parseInChunks(['data: oops\n\n', first])).toEqual(['step']);
  });
});
