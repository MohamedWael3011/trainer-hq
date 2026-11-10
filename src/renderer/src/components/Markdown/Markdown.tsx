import { memo, useCallback, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import './styles.css';

type PropsType = {
  text: string;
  baseDir?: string;
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

const WEB_LINK = /^(https?:|mailto:)/i;
// Inline code that is clearly a local path, e.g. `/Users/me/app/README.md` or `~/notes.md`.
const LOCAL_PATH = /^(~\/|\/)[^\s`]+$/;

// Links to local files (file:///..., /abs/path, relative/path) open through the main process,
// resolved against the quest's folder, then the vault.
const openLocal = (target: string, baseDir?: string): void => {
  void window.hq.openLocal(target, baseDir);
};

const makeLink = (baseDir?: string) => ({ href, children }: ComponentPropsWithoutRef<'a'>) => {
  if (!href || WEB_LINK.test(href)) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  return (
    <a href={href} title={href} onClick={(event) => { event.preventDefault(); openLocal(href, baseDir); }}>{children}</a>
  );
};

const makeCode = (baseDir?: string) => ({ className, children, node: _node, ...rest }: ComponentPropsWithoutRef<'code'> & { node?: unknown }) => {
  const text = typeof children === 'string' ? children : '';
  if (className || !LOCAL_PATH.test(text)) return <code className={className} {...rest}>{children}</code>;
  return <code className="md-path" title="Open" onClick={() => openLocal(text, baseDir)} {...rest}>{children}</code>;
};

const Table = ({ children }: ComponentPropsWithoutRef<'table'>) => (
  <div className="md-table"><table>{children}</table></div>
);

const Markdown = ({ text, baseDir }: PropsType) => {
  const components = useMemo<Components>(() => ({ pre: CodeBlock, a: makeLink(baseDir), code: makeCode(baseDir), table: Table }), [baseDir]);
  return (
    <div className="md selectable">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default memo(Markdown);
