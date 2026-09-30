'use client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { withCitations, type Citation } from '@/lib/analysis/citations';

export function AnswerMarkdown({
  content,
  citations,
}: {
  content: string;
  citations?: Citation[];
}) {
  return (
    <div className="min-w-0 space-y-3 break-words [&_h3]:font-semibold [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:pl-3">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children, href }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-foreground underline underline-offset-2"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: () => null,
          pre: ({ children }) => (
            <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-5">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="break-words text-[0.95em]">{children}</code>
          ),
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-2 py-1.5 text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1.5">{children}</td>
          ),
        }}
      >
        {withCitations(content, citations)}
      </Markdown>
    </div>
  );
}
