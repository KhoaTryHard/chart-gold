export type Citation = {
  start: number;
  end: number;
  url: string;
  title: string;
};

export function withCitations(content: string, citations: Citation[] = []) {
  const insertions = new Map<number, string[]>();
  const sources = new Map<string, number>();
  for (const citation of citations) {
    if (
      !/^https?:\/\//i.test(citation.url) ||
      citation.end < 1 ||
      citation.end > content.length
    )
      continue;
    if (!sources.has(citation.url)) sources.set(citation.url, sources.size + 1);
    const label = ` [${sources.get(citation.url)}](<${citation.url.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>)`;
    const existing = insertions.get(citation.end) ?? [];
    if (!existing.includes(label)) existing.push(label);
    insertions.set(citation.end, existing);
  }
  let result = content;
  for (const [end, labels] of [...insertions].sort((a, b) => b[0] - a[0]))
    result = result.slice(0, end) + labels.join('') + result.slice(end);
  return result;
}

export function byteOffsetToIndex(content: string, byteOffset: number) {
  return new TextDecoder().decode(
    new TextEncoder().encode(content).slice(0, byteOffset),
  ).length;
}
