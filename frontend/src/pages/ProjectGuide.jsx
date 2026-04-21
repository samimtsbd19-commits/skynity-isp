import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookOpen, Edit3, Eye, Save, Download, Copy, CheckCircle2,
  Bot, AlertCircle, FileText,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { apiGuideGet, apiGuideSave } from '../api/client';

// ── Markdown renderer overrides (Tailwind-styled) ──────────────
const MD_COMPONENTS = {
  h1: ({ children }) => <h1 className="text-3xl font-display mt-6 mb-3 text-text">{children}</h1>,
  h2: ({ children }) => <h2 className="text-2xl font-display mt-6 mb-3 text-amber border-b border-border-dim pb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 text-text">{children}</h3>,
  p:  ({ children }) => <p className="text-sm text-text-dim leading-relaxed my-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside text-sm text-text-dim space-y-1 my-2 ml-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-sm text-text-dim space-y-1 my-2 ml-2">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a:  ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-amber underline hover:text-amber-dim">{children}</a>,
  strong: ({ children }) => <strong className="text-text font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-text italic">{children}</em>,
  code: ({ inline, children }) => inline
    ? <code className="bg-surface2 text-amber px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
    : <code className="block bg-surface2 text-text-dim p-3 rounded-sm font-mono text-xs overflow-x-auto whitespace-pre">{children}</code>,
  pre: ({ children }) => <pre className="bg-surface2 border border-border-dim rounded-sm p-3 font-mono text-xs overflow-x-auto my-3 whitespace-pre text-text-dim">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-amber pl-4 italic text-text-mute my-3">{children}</blockquote>,
  hr: () => <hr className="border-border-dim my-6" />,
  table: ({ children }) => <div className="overflow-x-auto my-3"><table className="min-w-full text-xs border border-border-dim">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-surface2">{children}</thead>,
  th: ({ children }) => <th className="text-left px-3 py-2 text-mono text-[10px] uppercase tracking-wider text-text-mute border-b border-border-dim">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border-b border-border-dim/50 text-text-dim">{children}</td>,
  input: (props) => <input {...props} disabled className="mr-2" />,
};

export default function ProjectGuide() {
  const [mode, setMode] = useState('view');           // view | edit
  const [markdown, setMarkdown] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyHint, setCopyHint] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['project-guide'],
    queryFn: apiGuideGet,
  });

  useEffect(() => {
    if (data?.markdown && !dirty) setMarkdown(data.markdown);
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiGuideSave(markdown),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  function downloadMd() {
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'PROJECT_GUIDE.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyHint('Copied to clipboard!');
      setTimeout(() => setCopyHint(''), 2500);
    } catch {
      setCopyHint('Copy failed');
    }
  }

  // Count status markers
  const counts = {
    done:    (markdown.match(/- \[x\]|✅/gi) || []).length,
    pending: (markdown.match(/- \[ \]|⬜/gi) || []).length,
    wip:     (markdown.match(/🚧/gi) || []).length,
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        kicker="Documentation"
        title={<>Project <em>Guide</em></>}
        subtitle="Complete project overview, architecture, and AI handoff document. This file is the single source of truth — edit it as features are completed."
      />

      {/* ── Toolbar ── */}
      <div className="px-8 pb-3 flex items-center justify-between gap-3 flex-wrap">
        {/* Mode switch */}
        <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
          {[['view', 'View', Eye], ['edit', 'Edit', Edit3]].map(([k, l, Icon]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors ${
                mode === k ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
              }`}
            >
              <Icon size={12} /> {l}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider">
          <span className="flex items-center gap-1 text-green"><CheckCircle2 size={11} /> {counts.done} done</span>
          <span className="flex items-center gap-1 text-amber"><AlertCircle size={11} /> {counts.wip} in progress</span>
          <span className="flex items-center gap-1 text-text-mute"><FileText size={11} /> {counts.pending} pending</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {copyHint && <span className="text-xs text-green font-mono">{copyHint}</span>}
          <button
            onClick={copyAll}
            className="flex items-center gap-1 text-xs font-mono text-text-dim hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm"
            title="Copy markdown to clipboard (paste into any AI chat)"
          >
            <Copy size={12} /> Copy for AI
          </button>
          <button
            onClick={downloadMd}
            className="flex items-center gap-1 text-xs font-mono text-text-dim hover:text-amber px-2 py-1.5 border border-border-dim rounded-sm"
          >
            <Download size={12} /> Download
          </button>
          {mode === 'edit' && (
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !dirty}
              className={`flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded-sm transition-colors ${
                saved ? 'bg-green text-black' : dirty ? 'bg-amber text-black' : 'bg-surface2 text-text-mute cursor-not-allowed'
              }`}
            >
              <Save size={12} /> {save.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save Guide'}
            </button>
          )}
        </div>
      </div>

      {/* AI tip banner */}
      <div className="mx-8 mb-3 flex items-start gap-3 p-3 border border-amber/30 bg-amber/5 rounded-sm">
        <Bot size={18} className="text-amber shrink-0 mt-0.5" />
        <div className="text-xs text-text-dim leading-relaxed">
          <strong className="text-text">AI হ্যান্ডঅফ:</strong> Copy for AI বাটন চাপলে পুরো guide clipboard-এ copy হবে।
          যেকোনো AI chat-এ (ChatGPT/Claude/Gemini) paste করলে সে পুরো project জানবে — কোনো token খরচ ছাড়াই।
          Feature complete হলে <code className="text-amber font-mono bg-surface2 px-1 rounded">- [ ]</code> বদলে <code className="text-amber font-mono bg-surface2 px-1 rounded">- [x]</code> করে Save দিন — পরবর্তী AI সেখান থেকেই শুরু করবে।
        </div>
      </div>

      {save.isError && (
        <div className="mx-8 mb-2 text-xs font-mono text-red bg-red/10 border border-red/30 rounded px-3 py-1.5">
          {save.error?.response?.data?.error || save.error?.message}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 px-8 pb-8 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-text-mute font-mono text-sm">
            <BookOpen size={16} className="mr-2" /> Loading guide…
          </div>
        ) : mode === 'view' ? (
          <div className="h-full overflow-y-auto pr-2 panel p-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {markdown}
            </ReactMarkdown>
          </div>
        ) : (
          /* Edit mode: split view */
          <div className="h-full grid grid-cols-2 gap-3">
            <textarea
              className="bg-surface border border-border rounded-sm font-mono text-xs text-text p-4 resize-none focus:outline-none focus:border-amber transition-colors"
              value={markdown}
              onChange={(e) => { setMarkdown(e.target.value); setDirty(true); }}
              spellCheck={false}
              placeholder="# Project Guide&#10;&#10;Write markdown here..."
            />
            <div className="panel p-6 overflow-y-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                {markdown}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
