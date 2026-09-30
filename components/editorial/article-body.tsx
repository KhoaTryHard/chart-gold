import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PublicArticle } from '@/lib/editorial/types';

export function ArticleBody({ article }: { article: PublicArticle }) {
  return <div className="editorial-prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => href?.startsWith('/') ? <Link href={href}>{children}</Link> : /^https?:\/\//i.test(href ?? '') ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>, table: ({ children }) => <div className="editorial-table-wrap"><table>{children}</table></div> }}>{article.contentMarkdown}</ReactMarkdown></div>;
}
