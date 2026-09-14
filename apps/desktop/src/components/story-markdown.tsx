import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

export function StoryMarkdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
    USE_PROFILES: { html: true },
  }), [text]);
  return <div className="structure-story-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
