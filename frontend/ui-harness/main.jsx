// UI harness for the shared components (P2-ED). Fictional data only.
// Built + driven by backend/scripts/ui-components-check.py; not part of the app.
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import Button from '../src/components/ui/Button'
import IconButton from '../src/components/ui/IconButton'
import StatusBadge from '../src/components/ui/StatusBadge'
import ScrollTable from '../src/components/ui/ScrollTable'
import ReviewQueue from '../src/components/bulk/ReviewQueue'
import { STATUS_MAP } from '../src/utils/statusMap'

window.__calls = []

const people = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  code: `T${String(9000 + i)}`,
  name: `Test Person ${String.fromCharCode(65 + (i * 7) % 26)}${i}`,
  amount: ((i * 37) % 50) * 100,
}))
people[5].amount = null

const queueRows = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: 100 + i, code: `Q${100 + i}`, st: 'approved', amt: 1000 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: 200 + i, code: `Q${200 + i}`, st: 'rejected', amt: 500 })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: 300 + i, code: `Q${300 + i}`, st: 'pending', amt: 250.5 })),
  { id: 400, code: 'Q400', st: 'weird', amt: 1 },
]

function Harness() {
  const [busy, setBusy] = useState(true)
  return (
    <div className="p-4 space-y-6">
      <section data-section="buttons" className="flex flex-wrap gap-2 items-center">
        {['primary', 'secondary', 'ghost', 'danger', 'success', 'warning'].map(v => (
          <Button key={v} variant={v} data-variant={v}>{v}</Button>
        ))}
        <Button variant="primary" size="sm" data-variant="primary-sm">small</Button>
        {['green', 'red', 'amber', 'blue', 'indigo', 'slate'].map(t => (
          <Button key={t} variant="link" tone={t} data-variant={`link-${t}`}>link {t}</Button>
        ))}
        <Button variant="primary" busy={busy} busyLabel="Saving..." data-variant="busy" onClick={() => window.__calls.push('busy-click')}>Save now</Button>
        <button type="button" data-testid="toggle-busy" onClick={() => setBusy(b => !b)}>toggle busy</button>
      </section>

      <section data-section="icons" className="flex gap-2">
        <IconButton label="Close panel" icon="✕" data-icon="labelled" />
        <IconButton icon="★" data-icon="unlabelled" />
      </section>

      <section data-section="badges" className="flex flex-wrap gap-1">
        {Object.entries(STATUS_MAP).flatMap(([d, m]) => Object.keys(m).map(s => (
          <StatusBadge key={`${d}-${s}`} domain={d} status={s} />
        )))}
        <StatusBadge domain="ed_finance" status="SOMETHING_NEW" size="xs" />
        <StatusBadge domain="nope" status={null} />
      </section>

      <section data-section="table">
        <ScrollTable
          testId="people"
          maxHeight="max-h-[240px]"
          rows={people}
          initialSort={null}
          columns={[
            { key: 'code', header: 'Code', sortable: true },
            { key: 'name', header: 'Name', sortable: true },
            { key: 'amount', header: 'Amount', sortable: true, render: r => (r.amount === null ? '' : r.amount) },
            { key: 'note', header: 'Note', render: () => 'fictional' },
          ]}
          renderExpanded={r => <div data-detail-for={r.code}>Details of {r.code}</div>}
          expandLabel={r => `details for ${r.code}`}
        />
      </section>

      <section data-section="queue">
        <ReviewQueue
          rows={queueRows}
          statusOf={r => r.st}
          filters={[
            { id: 'all', label: 'All' },
            { id: 'pending', label: 'Pending' },
            { id: 'rejected', label: 'Rejected', tone: 'red', rowClass: 'bg-red-50/60' },
            { id: 'approved', label: 'Approved' },
          ]}
          order={{ pending: 0, rejected: 1, approved: 2 }}
          selectable
          allFilterActions={['approve']}
          moneyOf={r => r.amt}
          rowProps={r => ({ 'data-st': r.st })}
          columns={[
            { key: 'code', header: 'Code', render: r => r.code },
            { key: 'st', header: 'Status', render: r => r.st },
            { key: 'act', header: 'Actions', render: (r, api) => r.st === 'rejected'
              ? <Button variant="link" tone="indigo" onClick={() => api.openAction('return', [r.id])}>Return one</Button> : null },
          ]}
          actions={[
            { id: 'approve', label: n => `Approve (${n})`, variant: 'primary', eligible: r => r.st === 'pending',
              confirmText: (n, total) => `Approve ${n} rows worth ${total.toFixed(2)}?`, confirmLabel: 'Yes, approve',
              run: ids => { window.__calls.push(['approve', ids]); return Promise.resolve() } },
            { id: 'return', label: n => `Return (${n})`, variant: 'secondary', eligible: r => r.st === 'rejected',
              needsReason: true, minReasonLen: 5, reasonTitle: n => `Return ${n}`, reasonPlaceholder: 'Why?',
              submitLabel: 'Send back', run: (ids, reason) => { window.__calls.push(['return', ids, reason]); return Promise.resolve() } },
          ]}
          emptyText="Nothing"
        />
      </section>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<Harness />)
