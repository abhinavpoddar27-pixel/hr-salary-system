import { useAppStore } from '../../store/appStore'
import { useQuery } from '@tanstack/react-query'
import api from '../../utils/api'

export default function CompanyFilter({ className = '', compact = false }) {
  const { selectedCompany, setSelectedCompany } = useAppStore()

  const { data: res } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/settings/companies'),
    staleTime: 300000, retry: 0
  })
  const companies = res?.data?.data || []

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
      <option value="">All Companies</option>
      {companies.map((c) => (
        <option key={c.id} value={c.name}>
          {c.display_name || c.name}
        </option>
      ))}
    </select>
  )
}
