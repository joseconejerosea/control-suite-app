'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Assistant replies are GFM markdown (headings, tables, bold, lists). react-markdown
// emits bare HTML elements, so each one is styled here to match the chat bubbles.
const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="text-base font-bold mb-1.5 mt-1 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-1 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-1 first:mt-0">{children}</h3>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-indigo-600 underline">{children}</a>
  ),
  code: ({ children }) => (
    <code className="px-1 py-0.5 rounded bg-slate-200 text-[0.85em] font-mono">{children}</code>
  ),
  hr: () => <hr className="my-2 border-slate-200" />,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-300 pl-3 text-slate-600 my-2">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-200/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-slate-300 px-2 py-1 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
};

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
