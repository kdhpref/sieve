// 원본 content 블록에서 답변 문장(segment), 공식 citation, 검색 결과를 분리한다.
// citation은 API 메타데이터만 사용하며 URL을 생성하지 않는다.

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function parseCollected(content) {
  const segments = [];
  const citations = [];
  const citationKey = new Map();
  const searchQueries = [];
  const searchResults = [];
  const searchResultUrls = new Set();
  const toolErrors = [];
  let text = "";

  for (const block of content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      searchQueries.push(block.input?.query ?? "");
    } else if (block.type === "web_search_tool_result") {
      if (Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r.type !== "web_search_result" || searchResultUrls.has(r.url)) continue;
          searchResultUrls.add(r.url);
          searchResults.push({ url: r.url, title: r.title ?? "", page_age: r.page_age ?? null, domain: domainOf(r.url) });
        }
      } else if (block.content?.error_code) {
        toolErrors.push(block.content.error_code);
      }
    } else if (block.type === "text") {
      const ids = [];
      for (const c of block.citations ?? []) {
        if (c.type !== "web_search_result_location" || !c.url) continue;
        const key = `${c.url}\u0000${c.cited_text ?? ""}`;
        let id = citationKey.get(key);
        if (!id) {
          id = `c${citations.length + 1}`;
          citationKey.set(key, id);
          citations.push({ id, url: c.url, title: c.title ?? "", cited_text: c.cited_text ?? "", domain: domainOf(c.url) });
        }
        if (!ids.includes(id)) ids.push(id);
      }
      const start = text.length;
      text += block.text;
      segments.push({ id: `s${segments.length + 1}`, text: block.text, start, end: text.length, citation_ids: ids });
    }
  }

  for (const c of citations) c.in_search_results = searchResultUrls.has(c.url);

  return {
    text,
    segments,
    citations,
    search: {
      used: searchQueries.length > 0 && searchResults.length > 0,
      queries: searchQueries,
      results: searchResults,
      errors: toolErrors,
    },
  };
}
