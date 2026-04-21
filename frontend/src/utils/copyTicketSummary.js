// Builds a compact text summary for the "Copy ticket summary" button on the
// admin detail view — formatted so you can paste it directly into a Jira /
// Linear issue without reformatting. Always produces a string even if the
// Claude extraction is missing; the admin can edit before posting.

function safeParseJson(s) {
  if (!s) return null
  try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
}

export function buildTicketSummary(report) {
  if (!report) return ''

  const ex = safeParseJson(report.claude_extraction_json) || {}
  const auto = safeParseJson(report.auto_context_json) || {}

  const lines = []
  lines.push(`Bug Report #${report.id} — ${ex.page_identified || report.page_name || 'Unknown page'}`)
  lines.push(`Reporter: ${report.reporter_username} (${report.reporter_role})`)
  lines.push(`Submitted: ${report.created_at}`)
  lines.push(`Status: ${report.admin_status}`)
  lines.push('')

  if (ex.structured_summary) {
    lines.push('Summary:')
    lines.push(ex.structured_summary)
    lines.push('')
  }

  const desc = report.user_typed_comment || report.transcript_english
  if (desc) {
    lines.push('Reporter said:')
    lines.push(desc)
    lines.push('')
  }

  const vd = ex.visible_data || {}
  const hasData = (vd.employees_mentioned?.length || 0)
    + (vd.amounts_visible?.length || 0)
    + (vd.dates_visible?.length || 0) > 0
  if (hasData) {
    lines.push('Visible data:')
    if (vd.employees_mentioned?.length) lines.push(`  Employees: ${vd.employees_mentioned.join(', ')}`)
    if (vd.amounts_visible?.length)     lines.push(`  Amounts:   ${vd.amounts_visible.join(', ')}`)
    if (vd.dates_visible?.length)       lines.push(`  Dates:     ${vd.dates_visible.join(', ')}`)
    if (vd.key_values?.length) {
      for (const kv of vd.key_values) lines.push(`  ${kv.label}: ${kv.value}`)
    }
    lines.push('')
  }

  if (ex.open_questions?.length) {
    lines.push('Open questions:')
    for (const q of ex.open_questions) lines.push(`  • ${q}`)
    lines.push('')
  }

  lines.push(`Page URL: ${report.page_url || '—'}`)
  if (report.selected_month || report.selected_year || report.selected_company) {
    lines.push(`Context: ${report.selected_month || '?'}/${report.selected_year || '?'} ${report.selected_company || ''}`.trim())
  }
  const apis = auto.recent_api_calls || []
  if (apis.length) {
    lines.push(`Recent API calls (${apis.length}):`)
    for (const c of apis) lines.push(`  ${c.method} ${c.url} → ${c.status}`)
  }

  return lines.join('\n')
}

export async function copyToClipboard(text) {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (_e) { /* fall through */ }
  // Fallback for older browsers / insecure contexts
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (_e) {
    return false
  }
}
