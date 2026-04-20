import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Phone, Package as PackageIcon, Inbox, FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  apiOrders, apiApproveOrder, apiRejectOrder, apiOpenOrderInvoice,
} from '../api/client';
import { PageHeader } from '../components/PageHeader';
import { StatusPill, EmptyState, Skeleton } from '../components/primitives';

const FILTERS = [
  { value: 'payment_submitted', label: 'Needs review' },
  { value: 'pending_payment',   label: 'Awaiting pay' },
  { value: 'approved',          label: 'Approved' },
  { value: 'rejected',          label: 'Rejected' },
  { value: '',                  label: 'All' },
];

const currencyFmt = (n) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', maximumFractionDigits: 0 }).format(n || 0);

export default function Orders() {
  const [filter, setFilter] = useState('payment_submitted');
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ['orders', filter],
    queryFn: () => apiOrders(filter || undefined),
    refetchInterval: 30_000,
  });

  const approve = useMutation({
    mutationFn: apiApproveOrder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setSelected(null);
    },
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }) => apiRejectOrder(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setSelected(null);
    },
  });

  return (
    <div>
      <PageHeader
        kicker="Workflow"
        title={<>Orders <em className="text-text-mute">inbox</em></>}
        subtitle="Review paid orders and provision service with one click."
      />

      <div className="px-8 py-6">
        {/* filter bar */}
        <div className="flex items-center gap-1 mb-6 border-b border-border-dim pb-4">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors rounded-sm ${
                filter === f.value
                  ? 'bg-amber text-black'
                  : 'text-text-dim hover:text-text hover:bg-surface2'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* list */}
          <div className="lg:col-span-1 panel overflow-hidden">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}
              </div>
            ) : !orders?.length ? (
              <EmptyState
                title="Nothing here"
                hint={`No orders match “${FILTERS.find(f=>f.value===filter)?.label}”.`}
                icon={Inbox}
              />
            ) : (
              <ul className="divide-y divide-border-dim max-h-[70vh] overflow-y-auto">
                {orders.map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelected(o)}
                      className={`w-full text-left px-5 py-4 transition-colors ${
                        selected?.id === o.id
                          ? 'bg-surface2 border-l-2 border-amber'
                          : 'hover:bg-surface2/60 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-mono text-[11px] text-text-dim">{o.order_code}</span>
                        <span className="text-mono text-[10px] text-text-mute">
                          {formatDistanceToNow(new Date(o.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-medium truncate">{o.full_name}</div>
                      <div className="mt-0.5 text-xs text-text-dim truncate">{o.package_name}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <StatusPill status={o.status} />
                        <span className="text-mono text-xs text-amber">{currencyFmt(o.amount)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* detail */}
          <div className="lg:col-span-2">
            {!selected ? (
              <div className="panel h-full min-h-[400px] flex items-center justify-center">
                <EmptyState
                  title="Select an order"
                  hint="Tap an entry on the left to view details and approve."
                  icon={Inbox}
                />
              </div>
            ) : (
              <OrderDetail
                order={selected}
                onApprove={() => approve.mutate(selected.id)}
                onReject={(reason) => reject.mutate({ id: selected.id, reason })}
                approving={approve.isPending}
                rejecting={reject.isPending}
                error={approve.error || reject.error}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderDetail({ order, onApprove, onReject, approving, rejecting, error }) {
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <div className="panel overflow-hidden animate-fade-up">
      <div className="relative px-6 py-5 border-b border-border-dim">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber/40 to-transparent" />
        <div className="text-mono text-[10px] text-amber uppercase tracking-[0.25em] mb-2">
          Order · {order.order_code}
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-display text-3xl">{order.full_name}</h3>
          <div className="text-display text-3xl italic text-amber">{currencyFmt(order.amount)}</div>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs font-mono text-text-dim">
          <Phone size={12} /> {order.phone}
          <span className="text-text-mute">·</span>
          <StatusPill status={order.status} />
        </div>
      </div>

      <div className="p-6 grid sm:grid-cols-2 gap-6">
        <InfoBlock label="Package" icon={PackageIcon}>
          <div className="text-sm">{order.package_name}</div>
          <div className="text-xs text-text-mute mt-1 font-mono">{order.package_code}</div>
        </InfoBlock>
        <InfoBlock label="Submitted">
          <div className="text-sm">{new Date(order.created_at).toLocaleString()}</div>
          <div className="text-xs text-text-mute mt-1">
            {formatDistanceToNow(new Date(order.created_at), { addSuffix: true })}
          </div>
        </InfoBlock>
        {order.customer_name && (
          <InfoBlock label="Customer record">
            <div className="text-sm">{order.customer_name}</div>
          </InfoBlock>
        )}
        {order.telegram_id && (
          <InfoBlock label="Telegram ID">
            <div className="text-sm font-mono">{order.telegram_id}</div>
          </InfoBlock>
        )}
        {order.mac_address && (
          <InfoBlock label="MAC address">
            <div className="text-sm font-mono">{order.mac_address}</div>
            <div className="text-xs text-text-mute mt-1">captured at order time</div>
          </InfoBlock>
        )}
        {order.renewal_of_subscription_id && (
          <InfoBlock label="Renewal of">
            <div className="text-sm font-mono">#{order.renewal_of_subscription_id}</div>
            <div className="text-xs text-amber mt-1">approving will extend this subscription</div>
          </InfoBlock>
        )}
      </div>

      {order.status === 'approved' && (
        <div className="px-6 pb-6">
          <div className="flex items-center gap-3 pt-4 border-t border-border-dim">
            <button
              onClick={() => apiOpenOrderInvoice(order.id)}
              className="btn btn-ghost"
            >
              <FileText size={15} /> Open invoice
            </button>
          </div>
        </div>
      )}

      {order.status === 'payment_submitted' && (
        <div className="px-6 pb-6">
          {!rejectMode ? (
            <div className="flex items-center gap-3 pt-4 border-t border-border-dim">
              <button
                onClick={onApprove}
                disabled={approving}
                className="btn btn-primary flex-1"
              >
                <Check size={15} />
                {approving ? 'Provisioning…' : 'Approve & Provision'}
              </button>
              <button
                onClick={() => setRejectMode(true)}
                className="btn btn-danger"
              >
                <X size={15} /> Reject
              </button>
            </div>
          ) : (
            <div className="pt-4 border-t border-border-dim space-y-3">
              <div className="text-mono text-[10px] text-text-mute uppercase tracking-wider">
                Reason for rejection
              </div>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. TrxID not found"
                className="input"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onReject(reason)}
                  disabled={rejecting || !reason.trim()}
                  className="btn btn-danger flex-1"
                >
                  {rejecting ? 'Rejecting…' : 'Confirm rejection'}
                </button>
                <button onClick={() => setRejectMode(false)} className="btn btn-ghost">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-3 text-red text-xs font-mono">
              {error.response?.data?.error || error.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InfoBlock({ label, icon: Icon, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-mono text-[10px] text-text-mute uppercase tracking-wider mb-2">
        {Icon && <Icon size={11} />}
        {label}
      </div>
      {children}
    </div>
  );
}
