import { memo, useCallback, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import './styles.css';

type PropsType = {
  text: string;
};

const COPIED_MS = 1400;
const LANGUAGE_CLASS = /language-([\w-]+)/;

const CodeBlock = ({ children }: { children?: ReactNode }) => {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = (child as { props?: { className?: string } } | undefined)?.props?.className ?? '';
  const language = className.match(LANGUAGE_CLASS)?.[1];

  const copy = useCallback(() => {
    const text = ref.current?.innerText ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  }, []);

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{language ?? 'text'}</span>
        <button className="md-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
};

const Link = ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
  <a href={href} target="_blank" rel="noreferrer">{children}</a>
);

const Table = ({ children }: ComponentPropsWithoutRef<'table'>) => (
  <div className="md-table"><table>{children}</table></div>
);

const COMPONENTS: Components = {
  pre: CodeBlock,
  a: Link,
  table: Table,
};

const Markdown = ({ text }: PropsType) => (
  <div className="md selectable">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  </div>
);

export default memo(Markdown);
