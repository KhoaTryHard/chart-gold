'use client';
import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';

/** Render only provider metadata, never model-authored HTML. Shadow DOM isolates CSS. */
export function SearchSuggestions({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const root =
      host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' });
    root.innerHTML = DOMPurify.sanitize(html, {
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'img',
        'link',
      ],
      ADD_TAGS: ['style'],
      ADD_ATTR: ['target'],
    });
    root.querySelectorAll('a').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    return () => {
      root.innerHTML = '';
    };
  }, [html]);
  return (
    <div
      ref={host}
      className="mt-2 overflow-x-auto"
      aria-label="Google Search Suggestions"
    />
  );
}
