import { useAppStore } from '../../store/appStore'

const COMPANIES = [
  { value: '', label: 'All Companies' },
  { value: 'Indriyan Beverages', label: 'Indriyan Beverages' },
  { value: 'Asian Lakto', label: 'Asian Lakto' },
]

/**
 * Global company filter dropdown. Reads/writes selectedCompany from zustand store.
 * Place in page header bar alongside DateSelector.
 *
 * Props:
 *   className — optional extra Tailwind classes
 *   compact — if true, renders smaller (for tight spaces)
 */
export default function CompanyFilter({ className = '', compact = false }) {
  const { selectedCompany, setSelectedCompany } = useAppStore()

  return (
    <select
      value={selectedCompany}
      onChange={(e) => setSelectedCompany(e.target.value)}
      className={`
        border border-slate-300 rounded-lg bg-white text-slate-700
        focus:ring-2 focus:ring-blue-500 focus:border-blue-500
        ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}
        ${className}
      `}
    >
      {COMPANIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  )
}
