import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Brain, FileText, Save, Trash2, Plus, Copy, Edit3, Eye,
  Download, Bot, AlertCircle, CheckCircle2, X,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  apiMemoryList, apiMemoryRead, apiMemorySave, apiMemoryDelete, apiMemoryCombined,
} from '../api/client';

// Simple markdown components (matches ProjectGuide styling)
const MD = {
  h1: ({ children }) => <h1 className="text-2xl font-display mt-4 mb-2 text-text">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-display mt-4 mb-2 text-amber">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1 text-text">{children}</h3>,
  p:  ({ children }) => <p className="text-sm text-text-dim leading-relaxed my-2">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-inside text-sm text-text-dim space-y-1 my-2">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-sm text-text-dim space-y-1 my-2">{children}</ol>,
  a:  ({ href, children }) => <a href={href} target="_blank" rel="noopener" className="text-amber underline hover:text-amber-dim">{children}</a>,
  code: ({ inline, children }) => inline
    ? <code className="bg-surface2 text-amber px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
    : <code className="block bg-surface2 text-text-dim p-3 rounded font-mono text-xs overflow-x-auto whitespace-pre">{children}</code>,
  strong: ({ children }) => <strong className="text-text font-semibold">{children}</strong>,
  hr: () => <hr className="border-border-dim my-4" />,
  table: ({ children }) => <div className="overflow-x-auto my-3"><table className="text-xs border border-border-dim">{children}</table></div>,
  th: ({ children }) => <th className="text-left px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-mute border-b border-border-dim">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border-b border-border-dim/50 text-text-dim">{children}</td>,
};

const TYPE_COLORS = {
  feedback: 'text-amber border-amber/30 bg-amber/5',
  project:  'text-cyan border-cyan/30 bg-cyan/5',
  user:     'text-green border-green/30 bg-green/5',
  reference:'text-text-dim border-border bg-surface2',
  general:  'text-text-mute border-border-dim',
};

export default function Memory() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('view');        // view | edit
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copyHint, setCopyHint] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const list = useQuery({
    queryKey: ['memory-list'],
    queryFn: apiMemoryList,
  });

  const fileQuery = useQuery({
    queryKey: ['memory-file', selected],
    queryFn: () => apiMemoryRead(selected),
    enabled: !!selected,
  });

  useEffect(() => {
    if (fileQuery.data && !dirty) {
      setContent(fileQuery.data.content || '');
    }
  }, [fileQuery.data]);

  useEffect(() => {
    // Auto-select first file on load
    if (!selected && list.data?.files?.length) {
      setSelected(list.data.files[0].filename);
    }
  }, [list.data]);

  const save = useMutation({
    mutationFn: () => apiMemorySave(selected, content),
    onSuccess: () => {
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['memory-list'] });
    },
  });

  const del = useMutation({
    mutationFn: (file) => apiMemoryDelete(file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memory-list'] });
      setSelected(null);
      setContent('');
    },
  });

  async function copyCombined() {
    try {
      const r = await apiMemoryCombined();
      await navigator.clipboard.writeText(r.markdown);
      setCopyHint(`Copied ${r.files} files — paste into any AI chat`);
      setTimeout(() => setCopyHint(''), 3500);
    } catch { setCopyHint('Copy failed'); }
  }

  async function copySingle() {
    try {
      await navigator.clipboard.writeText(content);
      setCopyHint('Copied this file');
      setTimeout(() => setCopyHint(''), 2500);
    } catch { setCopyHint('Copy failed'); }
  }

  async function createNew() {
    const name = newName.trim();
    if (!name) return;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const template = `---
name: ${name.replace(/\.md$/, '')}
description: ${name.replace(/\.md$/, '')}
type: general
---

# ${name.replace(/\.md$/, '')}

Content here…
`;
    try {
      await apiMemorySave(filename, template);
      qc.invalidateQueries({ queryKey: ['memory-list'] });
      setCreating(false);
      setNewName('');
      setSelected(filename);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  }

  const currentFile = list.data?.files?.find((f) => f.filename === selected);

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        kicker="AI"
        title={<>Shared <em>Memory</em></>}
        subtitle="Portable AI context that lives in the repo — accessible from any PC, Telegram /ai, or paste into any Claude/ChatGPT chat."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {copyHint && <span className="text-xs text-green font-mono">{copyHint}</span>}
            <button onClick={copyCombined} className="btn btn-ghost text-xs">
              <Bot size={12} /> Copy All for AI
            </button>
            <button onClick={() => setCreating(true)} className="btn btn-primary text-xs">
              <Plus size={12} /> New Memory
            </button>
          </div>
        }
      />

      {/* AI banner */}
      <div className="mx-8 my-3 flex items-start gap-3 p-3 border border-amber/30 bg-amber/5 rounded-sm">
        <Brain size={16} className="text-amber shrink-0 mt-0.5" />
        <div className="text-xs text-text-dim leading-relaxed">
          <strong className="text-text">এই files docs/memory/ -তে repo-এর ভিতরে আছে</strong> →
          GitHub-এ push হলে VPS-এ sync, Telegram <code className="text-amber font-mono bg-surface2 px-1 rounded">/ai</code> এদের জানবে,
          অন্য PC থেকে Claude.ai-তে <em>Copy All for AI</em> দিয়ে paste করলে সেও জানবে। Windows reinstall-এও হারাবে না।
        </div>
      </div>

      {/* New memory inline form */}
      {creating && (
        <div className="mx-8 mb-3 flex items-center gap-2 p-3 border border-amber/30 bg-amber/5 rounded-sm">
          <input
            autoFocus
            className="input text-xs py-1.5 flex-1"
            placeholder="filename (e.g. user-preferences.md)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') createNew(); if (e.key === 'Escape') setCreating(false); }}
          />
          <button onClick={createNew} className="btn btn-primary text-xs">Create</button>
          <button onClick={() => setCreating(false)} className="btn btn-ghost text-xs"><X size={12} /></button>
        </div>
      )}

      <div className="flex-1 flex gap-0 px-8 pb-8 min-h-0">
        {/* ── Left: file list ── */}
        <aside className="w-64 shrink-0 border border-border-dim rounded-sm bg-surface overflow-y-auto">
          {list.isLoading ? (
            <div className="p-4 text-text-mute font-mono text-xs">Loading…</div>
          ) : (
            <div className="divide-y divide-border-dim">
              {list.data?.files?.map((f) => {
                const typeClass = TYPE_COLORS[f.type] || TYPE_COLORS.general;
                return (
                  <button
                    key={f.filename}
                    onClick={() => { setSelected(f.filename); setDirty(false); setMode('view'); }}
                    className={`w-full text-left p-3 transition-colors ${
                      selected === f.filename ? 'bg-surface2 border-l-2 border-amber' : 'hover:bg-surface2'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileText size={11} className="text-text-mute shrink-0" />
                      <span className="text-xs font-mono truncate flex-1">{f.filename}</span>
                    </div>
                    <div className="text-[10px] text-text-mute line-clamp-2 mb-1">{f.description}</div>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-mono px-1.5 py-px border rounded ${typeClass}`}>
                        {f.type}
                      </span>
                      <span className="text-[9px] text-text-mute font-mono">
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  </button>
                );
              })}
              {!list.data?.files?.length && (
                <div className="p-4 text-center text-text-mute font-mono text-xs">
                  No memory files yet
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── Right: content viewer/editor ── */}
        <main className="flex-1 flex flex-col min-w-0 ml-4">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-text-mute font-mono text-sm">
              <Brain size={20} className="mr-2" /> Pick a memory file from the left
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 border border-border-dim rounded-sm p-0.5">
                    {[['view', 'View', Eye], ['edit', 'Edit', Edit3]].map(([k, l, Icon]) => (
                      <button
                        key={k}
                        onClick={() => setMode(k)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider rounded-sm transition-colors ${
                          mode === k ? 'bg-amber text-black' : 'text-text-dim hover:text-text'
                        }`}
                      >
                        <Icon size={11} /> {l}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs font-mono text-text-mute">{selected}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copySingle} className="btn btn-ghost text-xs">
                    <Copy size={11} /> Copy
                  </button>
                  {currentFile && selected !== 'MEMORY.md' && (
                    <button
                      onClick={() => { if (confirm(`Delete ${selected}?`)) del.mutate(selected); }}
                      className="btn btn-ghost text-xs text-red hover:bg-red/10"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  )}
                  {mode === 'edit' && (
                    <button
                      onClick={() => save.mutate()}
                      disabled={save.isPending || !dirty}
                      className={`btn text-xs ${saved ? 'btn-success' : dirty ? 'btn-primary' : 'btn-ghost opacity-60'}`}
                    >
                      <Save size={11} /> {save.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save'}
                    </button>
                  )}
                </div>
              </div>

              {/* Body */}
              {fileQuery.isLoading ? (
                <div className="flex-1 flex items-center justify-center text-text-mute font-mono text-sm">Loading…</div>
              ) : mode === 'view' ? (
                <div className="flex-1 overflow-y-auto panel p-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{content}</ReactMarkdown>
                </div>
              ) : (
                <div className="flex-1 grid grid-cols-2 gap-3 min-h-0">
                  <textarea
                    className="bg-surface border border-border rounded-sm font-mono text-xs text-text p-4 resize-none focus:outline-none focus:border-amber"
                    value={content}
                    onChange={(e) => { setContent(e.target.value); setDirty(true); }}
                    spellCheck={false}
                  />
                  <div className="panel p-4 overflow-y-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{content}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
