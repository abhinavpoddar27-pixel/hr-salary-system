import React, { useState } from 'react'
import toast from 'react-hot-toast'
import { salesExportESI } from '../../utils/api'
import { fmtINR2 } from '../../utils/formatters'

// Statutory flags PR-3 — "Export ESI" on the sales salary register.
// Preview first (GET /sales/export/esi-contribution, no cache): when anyone with ESI is
// missing a valid 10-digit ESI number, list them with the amounts and say plainly they
// are NOT in the file; download only after HR confirms. RUNBOOK T7: file only when the
// missing list is 0. Read-only on the server (nothing is stamped).

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function SalesEsiExportButton({ month, year, company, disabled }) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)   // { filename, employees, missing, totals } while confirming
  const params = { month, year, company }

  const download = async (expectedMissing) => {
    setBusy(true)
    try {
      const resp = await salesExportESI(params, true)
      const cd = resp?.headers?.['content-disposition'] || ''
      const m = /filename="?([^";]+)"?/.exec(cd)
      saveBlob(resp.data, m ? m[1] : 'Sales_ESI.txt')
      const header = resp?.headers?.['x-missing-esi-number'] || ''
      const left = header ? header.split(',').filter(Boolean) : []
      if (left.length > 0) {
        toast(`ESI file downloaded — ${left.length} employee(s) NOT in it: ${left.join(', ')}`, { icon: '⚠', duration: 8000 })
        if (left.length !== expectedMissing) toast.error('The missing list changed since the preview — check it before filing')
      } else {
        toast.success('ESI file downloaded — everyone with ESI is in it')
      }
      setPreview(null)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'ESI file download failed')
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const resp = await salesExportESI(params, false)
      const d = resp?.data?.data
      if (!d) { toast.error('ESI preview failed'); return }
      if ((d.totals?.count || 0) === 0 && (d.missing?.length || 0) === 0) {
        toast('Nothing to file — no ESI rows for this cycle', { icon: 'ℹ' })
        return
      }
      if ((d.missing?.length || 0) > 0) { setPreview(d); return }
      setBusy(false)
      await download(0)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'ESI preview failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={start}
        disabled={busy || disabled}
        title="ESI contribution file for the ESIC portal (read-only — nothing is stamped)"
        data-testid="sales-esi-export"
        className="px-3 py-2 text-sm bg-teal-100 text-teal-700 rounded-lg hover:bg-teal-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed">
        {busy ? 'Exporting…' : 'Export ESI'}
      </button>

      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" data-testid="sales-esi-missing">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="px-5 py-3 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-800">ESI file — missing ESI numbers</h3>
              <p className="text-xs text-slate-500 mt-1">
                {preview.totals?.count || 0} employee(s) in the file · {preview.missing.length} NOT in the file
              </p>
            </div>
            <div className="px-5 py-3 space-y-3">
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                These employees have ESI but no valid 10-digit ESI number. They are <strong>NOT in the file</strong>, so
                their contribution below would not reach the ESIC portal. Add the numbers in Sales Employee Master (or the
                statutory upload) and export again — file only when this list is empty.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left">Code</th>
                      <th className="px-2 py-1 text-left">Name</th>
                      <th className="px-2 py-1 text-left">ESI number</th>
                      <th className="px-2 py-1 text-right">EE ₹</th>
                      <th className="px-2 py-1 text-right">ER ₹</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.missing.map((m) => (
                      <tr key={m.employee_code} className="border-t border-slate-100">
                        <td className="px-2 py-1 font-mono">{m.employee_code}</td>
                        <td className="px-2 py-1">{m.employee_name}</td>
                        <td className="px-2 py-1 text-rose-700">{m.reason === 'malformed' ? 'not 10 digits' : 'none'}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtINR2(m.ee)}</td>
                        <td className="px-2 py-1 text-right font-mono">{fmtINR2(m.er)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-sm bg-slate-50 border border-slate-200 rounded p-3">
                <div><strong>Not in the file:</strong> EE {fmtINR2(preview.totals?.missingEE)} · ER {fmtINR2(preview.totals?.missingER)}</div>
                <div><strong>File:</strong> <span className="font-mono text-xs">{preview.filename}</span> · {preview.totals?.count || 0} row(s), IP contribution {fmtINR2(preview.totals?.totalEEESI)}</div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-sm rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">
                Cancel
              </button>
              <button
                onClick={() => download(preview.missing.length)}
                disabled={busy}
                data-testid="sales-esi-confirm"
                className="px-3 py-1.5 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50">
                {busy ? 'Downloading…' : `Download anyway (${preview.missing.length} NOT in the file)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
