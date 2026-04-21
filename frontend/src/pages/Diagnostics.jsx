import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, RefreshCw, Zap, Send, Bot, Database,
  Activity, Wifi, AlertCircle, Eye, EyeOff, Save, Play, Cpu,
  MemoryStick, Clock, Settings as Cog,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import {
  apiDiagStatus, apiDiagTelegramTest, apiDiagTelegramRestart,
  apiDiagAiTest, apiDiagMikrotikTest, apiDiagMikrotikLive,
  apiSettings, apiSettingsBulk,
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
