// Contractor Report — Exceptions tab. Read-only.
import { money, days1, dateLong, EmptyState } from './shared'

function Section({ title, count, tone, headers, children }) {
  return (
    <div className="card mb-4">
      <div className="card-header">
        <span className="font-semibold text-slate-700">{title}</span>
        <span className={count ? tone : 'badge-gray'}>{count}</span>
      </div>
      {count > 0 && (
        <div className="overflow-x-auto">
          <table className="table-compact w-full">
            <thead>
              <tr>{headers.map((h) => (
                <th key={h.key} className={h.num ? 'text-right' : ''}>{h.label}</th>
              ))}</tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const H = (key, label, num) => ({ key, label, num })

export default function ExceptionsTab({ report, contractor, onOpenDay }) {
  const x = report.exceptions
  const keep = (o) => !contractor || o.contractor === contractor
  const both = x.both.filter(keep)
  const dup = x.dup.filter(keep)
  const pre = x.pre.filter(keep)
  const tie = x.tie.filter(keep)
  const financePending = (x.financePending || []).filter(keep)
  const stale = (x.stale || []).filter(keep)
  const aft = x.aft.filter(keep)
  const nodoj = x.nodoj.filter(keep)
  const pend = x.pend.filter(keep)
  // Rejected entries are a decision finance already made — shown for the record,
  // but they are terminal, so they are not part of the actionable count.
  const rejected = (x.rejected || []).filter(keep)
  const test = contractor ? [] : x.test
  const risk = both.reduce((s, o) => s + o.maxDoublePay, 0)

  const total = both.length + dup.length + pre.length + tie.length +
    financePending.length + stale.length +
    aft.length + nodoj.length + pend.length + rejected.length + test.length
  if (!total) {
    return <div className="card"><EmptyState>Nothing to flag for this month.</EmptyState></div>
  }

  return (
    <>
      <Section
        title={`Same contractor on biometric and daily wage, same day · up to ${money(risk)} possible double pay`}
        count={both.length} tone="badge-red"
        headers={[H('d', 'Date'), H('c', 'Contractor'), H('bd', '☀ Day', 1), H('bn', '☾ Night', 1),
          H('dw', 'Daily wage', 1), H('cost', 'DW cost', 1), H('r', 'Max double pay', 1)]}
      >
        {both.map((o, i) => (
          <tr key={i} className="cursor-pointer" onClick={() => onOpenDay(o.date, o.contractor)}>
            <td className="font-medium">{dateLong(o.date)}</td>
            <td>
              {o.contractor}
              {o.comparedAgainst && (
                <div className="text-xs text-slate-400">vs {o.comparedAgainst.join(' + ')} on biometric</div>
              )}
            </td>
            <td className="text-right tabular-nums">{o.bioDay}</td>
            <td className="text-right tabular-nums">{o.bioNight}</td>
            <td className="text-right tabular-nums">{o.dwHeads}</td>
            <td className="text-right tabular-nums">{money(o.dwCost)}</td>
            <td className="text-right tabular-nums font-semibold text-red-700">{money(o.maxDoublePay)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Two daily-wage records for one contractor on one day"
        count={dup.length} tone="badge-red"
        headers={[H('d', 'Date'), H('c', 'Contractor'), H('r', 'Records')]}
      >
        {dup.map((o, i) => (
          <tr key={i} className="cursor-pointer" onClick={() => onOpenDay(o.date, o.contractor)}>
            <td>{dateLong(o.date)}</td>
            <td>{o.contractor}</td>
            <td className="whitespace-normal">
              {o.records.map((r) => `${r.rawName}: ${r.heads} × ${money(r.rate)}`).join('  ·  ')}
            </td>
          </tr>
        ))}
      </Section>

      <Section
        title="Punched before joining date (payroll skipped these days)"
        count={pre.length} tone="badge-red"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('j', 'Joined'), H('d', 'Days before', 1)]}
      >
        {pre.map((o) => (
          <tr key={o.code}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td><td>{o.doj}</td>
            <td className="text-right tabular-nums">{o.days}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="HR corrections waiting for Finance · payroll is still paying these days"
        count={financePending.length} tone="badge-yellow"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('d', 'Date'),
          H('pa', 'Punched as'), H('hr', 'HR marked as'), H('src', 'From'), H('fs', 'Finance')]}
      >
        {financePending.map((o, i) => (
          <tr key={`${o.code}-${o.date}-${i}`}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td>
            <td>{dateLong(o.date)}</td>
            <td><span className="badge-green">{o.punchedAs || '—'}</span></td>
            <td><span className="badge-red">{o.hrMarkedAs || '—'}</span></td>
            <td className="text-slate-500">{o.correctionSource || '—'}</td>
            <td><span className="badge-yellow">{o.financeStatus}</span></td>
          </tr>
        ))}
      </Section>

      <Section
        title="Biometric days don’t match payroll days"
        count={tie.length} tone="badge-red"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('b', 'Biometric', 1), H('p', 'Payroll', 1)]}
      >
        {tie.map((o) => (
          <tr key={o.code}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td>
            <td className="text-right tabular-nums">
              {days1(o.payrollView ?? o.manDays)}
              {o.payrollView != null && o.payrollView !== o.manDays && (
                <div className="text-xs font-normal text-slate-400">
                  {days1(o.manDays)} before corrections waiting for Finance
                </div>
              )}
            </td>
            <td className="text-right tabular-nums">{days1(o.payrollDays)}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Punching after exit date (payroll still paid)"
        count={aft.length} tone="badge-yellow"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('e', 'Exit date'), H('d', 'Days after', 1)]}
      >
        {aft.map((o) => (
          <tr key={o.code}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td><td>{o.doe}</td>
            <td className="text-right tabular-nums">{o.days}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="No joining date on record"
        count={nodoj.length} tone="badge-yellow"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('d', 'Days present', 1)]}
      >
        {nodoj.map((o) => (
          <tr key={o.code}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td>
            <td className="text-right tabular-nums">{o.days}</td>
          </tr>
        ))}
      </Section>

      <Section
        title="Active on roster, no punch for 30+ days · as of today, not this month"
        count={stale.length} tone="badge-yellow"
        headers={[H('c', 'Code'), H('n', 'Name'), H('ct', 'Contractor'), H('j', 'Joined'),
          H('lp', 'Last punch'), H('ds', 'Days since', 1)]}
      >
        {stale.map((o) => (
          <tr key={o.code}>
            <td className="font-mono text-slate-500">{o.code}</td>
            <td>{o.name}</td><td>{o.contractor}</td>
            <td>{o.doj || <span className="text-slate-400">—</span>}</td>
            <td>
              {o.lastPunch
                ? dateLong(o.lastPunch)
                : <span className="badge-red">never</span>}
            </td>
            <td className="text-right tabular-nums">
              {o.daysSince == null ? <span className="text-slate-400">—</span> : o.daysSince}
            </td>
          </tr>
        ))}
      </Section>

      <Section
        title="Daily-wage entries not counted (not approved)"
        count={pend.length} tone="badge-yellow"
        headers={[H('d', 'Date'), H('r', 'Record'), H('h', 'Heads', 1), H('s', 'Status')]}
      >
        {pend.map((o, i) => (
          <tr key={i} className="cursor-pointer" onClick={() => onOpenDay(o.date, o.contractor)}>
            <td>{dateLong(o.date)}</td>
            <td>{o.rawName}</td>
            <td className="text-right tabular-nums">{o.heads}</td>
            <td><span className="badge-yellow">{o.status}</span></td>
          </tr>
        ))}
      </Section>

      <Section
        title="Daily-wage entries rejected by finance (not counted, no action needed)"
        count={rejected.length} tone="badge-gray"
        headers={[H('d', 'Date'), H('r', 'Record'), H('h', 'Heads', 1), H('s', 'Status')]}
      >
        {rejected.map((o, i) => (
          <tr key={i} className="cursor-pointer" onClick={() => onOpenDay(o.date, o.contractor)}>
            <td>{dateLong(o.date)}</td>
            <td>{o.rawName}</td>
            <td className="text-right tabular-nums">{o.heads}</td>
            <td><span className="badge-gray">{o.status}</span></td>
          </tr>
        ))}
      </Section>

      <Section
        title="Test entries to void"
        count={test.length} tone="badge-yellow"
        headers={[H('d', 'Date'), H('r', 'Record'), H('h', 'Heads', 1), H('a', 'Amount', 1), H('s', 'Status')]}
      >
        {test.map((o, i) => (
          <tr key={i}>
            <td>{dateLong(o.date)}</td>
            <td>{o.rawName}</td>
            <td className="text-right tabular-nums">{o.heads}</td>
            <td className="text-right tabular-nums">{money(o.amount)}</td>
            <td><span className="badge-yellow">{o.status}</span></td>
          </tr>
        ))}
      </Section>
    </>
  )
}
