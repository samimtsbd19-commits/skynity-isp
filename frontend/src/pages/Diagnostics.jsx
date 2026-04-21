import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, RefreshCw, Zap, Send, Bot, Database,
  Activity, Wifi, AlertCircle, Eye, EyeOff, Save, Play, Cpu,
  MemoryStick, Clock, Settings as Cog, ShieldAlert, Cookie, Trash2,
  Sparkles, Wrench, Radio,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  apiDiagStatus, apiDiagTelegramTest, apiDiagTelegramRestart,
  apiDiagAiTest, apiDiagMikrotikTest, apiDiagMikrotikLive,
  apiSettings, apiSettingsBulk,
  apiHotspotAudit, apiHotspotFix,
} from '../api/client';

// ── Status pill ──────────────────────────────────────────────
function StatusPill({ ok, warn, label }) {
  const color = ok ? 'text-green' : warn ? 'text-amber' : 'text-red';
  const Icon  = ok ? CheckCircle2 : warn ? AlertCircle : XCircle;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider ${color}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

function Card({ icon: Icon, title, status, children }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-amber" />
          <h3 className="font-display text-lg">{title}</h3>
        </div>
        {status}
      </div>
      {children}
    </div>
  );
}

// ── Helper to edit a single setting ─────────────────────────
function useSetting(key) {
  const qc = useQueryClient();
  const { data: all = [] } = useQuery({ queryKey: ['settings'], queryFn: apiSettings });
  const row = all.find((s) => s.key === key);
  const save = useMutation({
    mutationFn: (value) => apiSettingsBulk([{ key, type: row?.type || 'string', value }]),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  return { value: row?.value ?? '', save, row };
}

// ═════════════════════════════════════════════════════════════
export default function Diagnostics() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['diag-status'],
    queryFn: apiDiagStatus,
    refetchInterval: 10_000,
  });

  return (
    <div>
      <PageHeader
        kicker="Admin"
        title={<>Live <em>Diagnostics</em></>}
        subtitle="Configure tokens, test connections, and hot-reload services without editing .env or restarting the backend."
        actions={
          <button onClick={() => qc.invalidateQueries({ queryKey: ['diag-status'] })} className="btn btn-ghost">
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />

      <div className="px-8 py-6 grid gap-5 grid-cols-1 lg:grid-cols-2">
        <TelegramCard status={status.data?.telegram} />
        <AiCard       status={status.data?.ai} />
        <MikroTikCard status={status.data?.mikrotik} />
        <InfraCard    status={status.data} />
      </div>

      {/* Full-width Hotspot Security & Health audit */}
      <div className="px-8 pb-8">
        <HotspotAuditCard />
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// HOTSPOT SECURITY & HEALTH
// ═════════════════════════════════════════════════════════════
function HotspotAuditCard() {
  const qc = useQueryClient();
  const [fixMsg, setFixMsg] = useState(null);
  const [fixingId, setFixingId] = useState(null);

  const audit = useQuery({
    queryKey: ['hotspot-audit'],
    queryFn: () => apiHotspotAudit(),
    refetchInterval: 30_000,
  });

  async function runFix(action, target = null, findingId = null) {
    setFixingId(findingId || action);
    setFixMsg(null);
    try {
      const body = target ? { target } : {};
      const r = await apiHotspotFix(action, body);
      setFixMsg({ ok: r.ok, text: r.message || (r.ok ? 'Done' : r.error) });
      qc.invalidateQueries({ queryKey: ['hotspot-audit'] });
    } catch (err) {
      setFixMsg({ ok: false, text: err.response?.data?.error || err.message });
    } finally {
      setFixingId(null);
      setTimeout(() => setFixMsg(null), 5000);
    }
  }

  const data = audit.data;
  const findings = data?.findings || [];
  const stats = data?.stats || {};
  const critical = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warn').length;
  const info = findings.filter((f) => f.severity === 'info').length;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-amber" />
          <h3 className="font-display text-lg">Hotspot Security & Health</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {critical > 0 && <StatusPill label={`${critical} critical`} />}
          {warnings > 0 && <StatusPill warn label={`${warnings} warning${warnings > 1 ? 's' : ''}`} />}
          {info > 0 && <StatusPill ok label={`${info} info`} />}
          {findings.length === 0 && data && <StatusPill ok label="All clear" />}
          <button
            onClick={() => runFix('optimize-public-hotspot')}
            disabled={fixingId === 'optimize-public-hotspot'}
            className="btn btn-primary text-xs"
            title="One-click best practices for public hotspots"
          >
            <Sparkles size={12} /> {fixingId === 'optimize-public-hotspot' ? 'Optimizing…' : 'Optimize for Public Hotspot'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-5 text-xs font-mono">
          <Stat label="Active" value={stats.active_sessions} />
          <Stat label="Stored Cookies" value={stats.stored_cookies} warn={stats.stored_cookies > 50} />
          <Stat label="Authorized Hosts" value={stats.authorized_hosts} />
          <Stat label="Stale Hosts" value={stats.stale_hosts} warn={stats.stale_hosts > 20} />
          <Stat label="DHCP Leases" value={stats.dhcp_leases} />
          <Stat label="Profiles" value={stats.server_profiles} />
        </div>
      )}

      {/* Findings list */}
      {audit.isLoading && (
        <div className="text-center text-text-mute font-mono text-sm py-8">
          <Activity size={16} className="inline animate-pulse mr-2" /> Auditing hotspot…
        </div>
      )}
      {audit.error && (
        <div className="text-xs font-mono text-red bg-red/5 border border-red/30 rounded-sm p-3">
          ✗ {audit.error.message}
        </div>
      )}
      {data?.ok === false && (
        <div className="text-xs font-mono text-red bg-red/5 border border-red/30 rounded-sm p-3">
          ✗ {data.error}
        </div>
      )}

      {findings.length === 0 && data && !audit.isLoading && (
        <div className="text-center text-green font-mono text-sm py-4">
          <CheckCircle2 size={16} className="inline mr-2" /> No issues detected — hotspot is healthy
        </div>
      )}

      {findings.length > 0 && (
        <div className="space-y-2">
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              onFix={() => runFix(f.fix_action, f.fix_target, f.id)}
              fixing={fixingId === f.id}
            />
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-5 pt-4 border-t border-border-dim">
        <div className="text-mono text-[10px] uppercase tracking-widest text-text-mute mb-2">
          Quick actions (use when user says "worked yesterday, fails today")
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => runFix('clear-cookies')}
            disabled={fixingId === 'clear-cookies'}
            className="btn btn-ghost text-xs"
          >
            <Cookie size={12} /> {fixingId === 'clear-cookies' ? 'Clearing…' : 'Clear All Cookies'}
          </button>
          <button
            onClick={() => runFix('clear-stale-hosts')}
            disabled={fixingId === 'clear-stale-hosts'}
            className="btn btn-ghost text-xs"
          >
            <Trash2 size={12} /> {fixingId === 'clear-stale-hosts' ? 'Clearing…' : 'Clear Stale Hosts'}
          </button>
          <button
            onClick={() => runFix('walled-garden-defaults')}
            disabled={fixingId === 'walled-garden-defaults'}
            className="btn btn-ghost text-xs"
            title="Allow iOS/Android captive-portal detection URLs"
          >
            <Radio size={12} /> Add Captive-Portal Defaults
          </button>
        </div>
      </div>

      {fixMsg && (
        <div className={`mt-3 text-xs font-mono p-2 rounded-sm border ${
          fixMsg.ok ? 'text-green border-green/30 bg-green/5' : 'text-red border-red/30 bg-red/5'
        }`}>
          {fixMsg.ok ? '✓' : '✗'} {fixMsg.text}
        </div>
      )}

      {/* Server profile details */}
      {data?.server_profiles?.length > 0 && (
        <details className="mt-5 text-xs">
          <summary className="cursor-pointer text-text-mute font-mono uppercase tracking-wider text-[10px] hover:text-amber">
            Server profile details ({data.server_profiles.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-text-mute">
                <tr>
                  <th className="text-left px-2 py-1 font-mono">Profile</th>
                  <th className="text-left px-2 py-1 font-mono">Login By</th>
                  <th className="text-left px-2 py-1 font-mono">Cookie Lifetime</th>
                  <th className="text-left px-2 py-1 font-mono">Idle Timeout</th>
                  <th className="text-left px-2 py-1 font-mono">MAC Auth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dim">
                {data.server_profiles.map((p) => (
                  <tr key={p.id}>
                    <td className="px-2 py-1 font-mono">{p.name}</td>
                    <td className="px-2 py-1 font-mono text-text-dim">{p.login_by || '—'}</td>
                    <td className="px-2 py-1 font-mono text-text-dim">{p.http_cookie_lifetime || '—'}</td>
                    <td className="px-2 py-1 font-mono text-text-dim">{p.idle_timeout || '—'}</td>
                    <td className="px-2 py-1 font-mono text-text-dim">{p.mac_auth || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, warn = false }) {
  return (
    <div className={`border rounded-sm px-3 py-2 ${warn ? 'border-amber/40 bg-amber/5' : 'border-border-dim bg-surface2/40'}`}>
      <div className="text-[9px] uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`text-lg ${warn ? 'text-amber' : 'text-text'}`}>{value ?? '—'}</div>
    </div>
  );
}

function FindingRow({ finding, onFix, fixing }) {
  const sev = finding.severity;
  const colors = sev === 'error'
    ? { border: 'border-red/40', bg: 'bg-red/5', icon: 'text-red', Icon: XCircle }
    : sev === 'warn'
    ? { border: 'border-amber/40', bg: 'bg-amber/5', icon: 'text-amber', Icon: AlertCircle }
    : { border: 'border-cyan/30', bg: 'bg-cyan/5', icon: 'text-cyan', Icon: AlertCircle };
  const Icon = colors.Icon;

  return (
    <div className={`border ${colors.border} ${colors.bg} rounded-sm p-3 flex items-start gap-3`}>
      <Icon size={14} className={`shrink-0 mt-0.5 ${colors.icon}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{finding.title}</span>
          <span className="text-[9px] font-mono uppercase tracking-wider text-text-mute">{finding.category}</span>
        </div>
        <div className="text-xs text-text-dim mt-1 leading-relaxed">{finding.description}</div>
        {finding.detail && (
          <div className="text-[10px] font-mono text-text-mute mt-1">{finding.detail}</div>
        )}
      </div>
      {finding.fix_action && (
        <button
          onClick={onFix}
          disabled={fixing}
          className="btn btn-ghost text-xs shrink-0"
        >
          <Wrench size={11} /> {fixing ? 'Fixing…' : finding.fix_label || 'Fix'}
        </button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// TELEGRAM CARD
// ═════════════════════════════════════════════════════════════
function TelegramCard({ status: s }) {
  const token = useSetting('telegram.bot_token');
  const admins = useSetting('telegram.admin_ids');
  const enabled = useSetting('telegram.bot_enabled');
  const [show, setShow] = useState(false);
  const [localToken, setLocalToken] = useState(null);
  const [localAdmins, setLocalAdmins] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [restartMsg, setRestartMsg] = useState('');

  const tokenVal = localToken ?? token.value ?? '';
  const adminVal = localAdmins ?? admins.value ?? '';

  async function runTest() {
    setTesting(true); setTestResult(null);
    const r = await apiDiagTelegramTest(tokenVal).catch((e) => ({ ok: false, error: e.message }));
    setTestResult(r);
    setTesting(false);
  }

  async function saveAndRestart() {
    try {
      if (localToken !== null)  await token.save.mutateAsync(localToken);
      if (localAdmins !== null) await admins.save.mutateAsync(localAdmins);
      setLocalToken(null); setLocalAdmins(null);
      setRestartMsg('Restarting bot…');
      const r = await apiDiagTelegramRestart();
      setRestartMsg(r.ok ? `✓ Bot restarted (${r.adminCount || 0} admins)` : `✗ ${r.error || 'Failed'}`);
      setTimeout(() => setRestartMsg(''), 4000);
    } catch (e) {
      setRestartMsg(`✗ ${e.message}`);
    }
  }

  const pill = s?.running
    ? <StatusPill ok label="Running" />
    : s?.hasToken
    ? <StatusPill warn label="Has token, not running" />
    : <StatusPill label="Not configured" />;

  return (
    <Card icon={Bot} title="Telegram Bot" status={pill}>
      <div className="space-y-3">
        <Field label="Bot Token" hint="Get from @BotFather on Telegram">
          <div className="flex gap-2">
            <input
              type={show ? 'text' : 'password'}
              className="input text-xs py-1.5 flex-1 font-mono"
              value={tokenVal}
              onChange={(e) => setLocalToken(e.target.value)}
              placeholder="1234567890:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            />
            <button onClick={() => setShow(!show)} className="btn btn-ghost px-2" title={show ? 'Hide' : 'Show'}>
              {show ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        </Field>

        <Field label="Admin Telegram IDs" hint="Comma-separated, e.g. 123456,789012">
          <input
            className="input text-xs py-1.5 w-full font-mono"
            value={adminVal}
            onChange={(e) => setLocalAdmins(e.target.value)}
            placeholder="123456789,987654321"
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <button
            onClick={runTest}
            disabled={!tokenVal || testing}
            className="btn btn-ghost text-xs"
          >
            <Zap size={12} /> {testing ? 'Testing…' : 'Test Token'}
          </button>
          <button
            onClick={saveAndRestart}
            disabled={!tokenVal}
            className="btn btn-primary text-xs"
          >
            <Save size={12} /> Save & Restart Bot
          </button>
        </div>

        {testResult && (
          <div className={`text-xs font-mono p-2 rounded-sm border ${testResult.ok ? 'text-green border-green/30 bg-green/5' : 'text-red border-red/30 bg-red/5'}`}>
            {testResult.ok
              ? `✓ Connected as @${testResult.bot?.username} (${testResult.bot?.first_name})`
              : `✗ ${testResult.error}`}
          </div>
        )}
        {restartMsg && <div className="text-xs font-mono text-amber">{restartMsg}</div>}
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════
// AI CARD
// ═════════════════════════════════════════════════════════════
function AiCard({ status: s }) {
  const orKey = useSetting('ai.openrouter.api_key');
  const anKey = useSetting('ai.claude.api_key');
  const orEnabled = useSetting('ai.openrouter.enabled');
  const masterEnabled = useSetting('ai.claude.enabled');
  const [showOr, setShowOr] = useState(false);
  const [showAn, setShowAn] = useState(false);
  const [localOr, setLocalOr] = useState(null);
  const [localAn, setLocalAn] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');

  const orVal = localOr ?? orKey.value ?? '';
  const anVal = localAn ?? anKey.value ?? '';

  async function save() {
    try {
      if (localOr !== null) await orKey.save.mutateAsync(localOr);
      if (localAn !== null) await anKey.save.mutateAsync(localAn);
      setLocalOr(null); setLocalAn(null);
      setSaveMsg('✓ Saved — AI uses fresh key on next request');
      setTimeout(() => setSaveMsg(''), 3500);
    } catch (e) {
      setSaveMsg(`✗ ${e.message}`);
    }
  }

  async function runTest() {
    setTesting(true); setTestResult(null);
    const r = await apiDiagAiTest().catch((e) => ({ ok: false, error: e.message }));
    setTestResult(r);
    setTesting(false);
  }

  const pill = s?.configured
    ? <StatusPill ok label={`OK · ${s.provider}`} />
    : <StatusPill warn label="No valid key" />;

  return (
    <Card icon={Zap} title="AI (Claude / OpenRouter)" status={pill}>
      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-text-mute font-mono">Use:</span>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={orEnabled.value === 'true' || orEnabled.value === true} onChange={() => orEnabled.save.mutate('true')} />
            <span>OpenRouter (recommended)</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!(orEnabled.value === 'true' || orEnabled.value === true)} onChange={() => orEnabled.save.mutate('false')} />
            <span>Anthropic direct</span>
          </label>
        </div>

        <Field label="OpenRouter API Key" hint="openrouter.ai/keys">
          <div className="flex gap-2">
            <input
              type={showOr ? 'text' : 'password'}
              className="input text-xs py-1.5 flex-1 font-mono"
              value={orVal}
              onChange={(e) => setLocalOr(e.target.value)}
              placeholder="sk-or-v1-..."
            />
            <button onClick={() => setShowOr(!showOr)} className="btn btn-ghost px-2">{showOr ? <EyeOff size={12} /> : <Eye size={12} />}</button>
          </div>
        </Field>

        <Field label="Anthropic Claude API Key" hint="console.anthropic.com">
          <div className="flex gap-2">
            <input
              type={showAn ? 'text' : 'password'}
              className="input text-xs py-1.5 flex-1 font-mono"
              value={anVal}
              onChange={(e) => setLocalAn(e.target.value)}
              placeholder="sk-ant-api03-..."
            />
            <button onClick={() => setShowAn(!showAn)} className="btn btn-ghost px-2">{showAn ? <EyeOff size={12} /> : <Eye size={12} />}</button>
          </div>
        </Field>

        <div className="flex items-center gap-2 pt-2">
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox"
              checked={masterEnabled.value === 'true' || masterEnabled.value === true}
              onChange={(e) => masterEnabled.save.mutate(String(e.target.checked))} />
            <span>AI master switch enabled</span>
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={runTest} disabled={testing} className="btn btn-ghost text-xs">
            <Play size={12} /> {testing ? 'Testing…' : 'Live Test'}
          </button>
          <button onClick={save} className="btn btn-primary text-xs">
            <Save size={12} /> Save
          </button>
        </div>

        {testResult && (
          <div className={`text-xs font-mono p-2 rounded-sm border ${testResult.ok ? 'text-green border-green/30 bg-green/5' : 'text-red border-red/30 bg-red/5'}`}>
            {testResult.ok
              ? <>✓ {testResult.provider} · {testResult.model} · {testResult.latency_ms}ms<br/>Response: "{testResult.response}"</>
              : `✗ ${testResult.error}`}
          </div>
        )}
        {saveMsg && <div className="text-xs font-mono text-amber">{saveMsg}</div>}
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════
// MIKROTIK CARD
// ═════════════════════════════════════════════════════════════
function MikroTikCard({ status: s }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [liveOn, setLiveOn] = useState(false);

  const live = useQuery({
    queryKey: ['diag-mt-live'],
    queryFn: () => apiDiagMikrotikLive(),
    refetchInterval: liveOn ? 3000 : false,
    enabled: liveOn,
  });

  async function runTest() {
    setTesting(true); setTestResult(null);
    const r = await apiDiagMikrotikTest().catch((e) => ({ ok: false, error: e.message }));
    setTestResult(r);
    setTesting(false);
  }

  const pill = s?.configured
    ? <StatusPill ok label={`${s.router?.name} · ${s.router?.host}`} />
    : <StatusPill warn label="No default router" />;

  return (
    <Card icon={Wifi} title="MikroTik Router" status={pill}>
      <div className="space-y-3">
        <div className="text-xs text-text-dim leading-relaxed">
          Router credentials are in the <a href="/routers" className="text-amber underline">Routers</a> page.
          Primary fallback: <code className="bg-surface2 px-1 rounded font-mono text-[10px]">.env</code> (<code className="font-mono text-[10px]">MIKROTIK_HOST/USERNAME/PASSWORD</code>).
        </div>

        <div className="flex gap-2">
          <button onClick={runTest} disabled={testing} className="btn btn-ghost text-xs">
            <Zap size={12} /> {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={() => setLiveOn(!liveOn)}
            className={`btn text-xs ${liveOn ? 'btn-primary' : 'btn-ghost'}`}
          >
            <Activity size={12} /> {liveOn ? 'LIVE · 3s refresh' : 'Enable Live Stats'}
          </button>
        </div>

        {testResult && (
          <div className={`text-xs font-mono p-2 rounded-sm border ${testResult.ok ? 'text-green border-green/30 bg-green/5' : 'text-red border-red/30 bg-red/5'}`}>
            {testResult.ok ? (
              <>
                ✓ {testResult.identity} · RouterOS {testResult.version} · {testResult.latency_ms}ms<br/>
                CPU: {testResult.cpu_load}% · Memory free: {Math.round((testResult.free_memory || 0) / 1024 / 1024)} MB / {Math.round((testResult.total_memory || 0) / 1024 / 1024)} MB
              </>
            ) : `✗ ${testResult.error}`}
          </div>
        )}

        {liveOn && live.data?.ok && (
          <div className="border border-green/30 bg-green/5 rounded-sm p-3 space-y-2">
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="flex items-center gap-1 text-green">
                <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse" /> LIVE
              </span>
              <span><Cpu size={10} className="inline mr-1" />CPU {live.data.resource?.cpu_load}%</span>
              <span><MemoryStick size={10} className="inline mr-1" />MEM {Math.round((live.data.resource?.free_memory || 0) / 1024 / 1024)} MB free</span>
              <span><Clock size={10} className="inline mr-1" />UP {live.data.resource?.uptime}</span>
            </div>
            <div className="flex gap-3 text-xs">
              <span className="text-text-dim">PPPoE online: <b className="text-amber">{live.data.pppoe_online}</b></span>
              <span className="text-text-dim">Hotspot online: <b className="text-amber">{live.data.hotspot_online}</b></span>
            </div>
            <div className="max-h-40 overflow-y-auto text-[10px] font-mono">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface2">
                  <tr>
                    <th className="text-left px-2 py-1 text-text-mute">Interface</th>
                    <th className="text-right px-2 py-1 text-text-mute">RX</th>
                    <th className="text-right px-2 py-1 text-text-mute">TX</th>
                  </tr>
                </thead>
                <tbody>
                  {live.data.interfaces?.map((i) => (
                    <tr key={i.name} className={i.running ? '' : 'opacity-50'}>
                      <td className="px-2 py-1">{i.name}</td>
                      <td className="text-right px-2 py-1 text-text">{fmtBytes(i.rx_byte)}</td>
                      <td className="text-right px-2 py-1 text-text">{fmtBytes(i.tx_byte)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ═════════════════════════════════════════════════════════════
// INFRASTRUCTURE CARD
// ═════════════════════════════════════════════════════════════
function InfraCard({ status: s }) {
  const dbOk = s?.database?.ok;
  return (
    <Card icon={Database} title="Infrastructure" status={
      dbOk ? <StatusPill ok label="All systems OK" /> : <StatusPill label="Issues" />
    }>
      <div className="space-y-2 text-xs font-mono">
        <Row label="MySQL" ok={dbOk} extra={s?.database?.latency_ms ? `${s.database.latency_ms}ms` : ''} err={s?.database?.error} />
        <Row label="Redis" ok={s?.redis?.ok} />
        <Row label="Uploads" ok extra="/app/uploads" />
        <Row label="WireGuard" ok extra="VPS 10.88.0.1 ↔ MT 10.88.0.2" />
      </div>
      <div className="mt-3 pt-3 border-t border-border-dim text-[11px] text-text-mute leading-relaxed">
        Status auto-refreshes every 10 seconds. Secrets (JWT, DB password) remain in <code className="bg-surface2 px-1 rounded">.env</code> for security.
      </div>
    </Card>
  );
}

function Row({ label, ok, extra, err }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={12} className="text-green" /> : <XCircle size={12} className="text-red" />}
        <span>{label}</span>
      </span>
      <span className={ok ? 'text-text-dim' : 'text-red'}>{err || extra}</span>
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-[10px] font-mono text-text-mute uppercase tracking-wider mb-1">
        {label}
        {hint && <span className="text-text-mute normal-case tracking-normal ml-2">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function fmtBytes(b) {
  const n = Number(b || 0);
  if (!n) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
