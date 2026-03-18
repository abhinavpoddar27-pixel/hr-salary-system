import { useState, useCallback } from 'react'
import { useAppStore } from '../store/appStore'

/**
 * useDateSelector — Manages local date state for a page and provides
 * spread-ready props for the DateSelector component.
 *
 * Usage:
 *   const { month, year, dateRangeMode, dateRangeStart, dateRangeEnd, dateProps } = useDateSelector({ mode: 'month', syncToStore: true })
 *   return <DateSelector {...dateProps} />
 */
export default function useDateSelector({ mode = 'month', syncToStore = false } = {}) {
  const storeMonth = useAppStore(s => s.selectedMonth)
  const storeYear = useAppStore(s => s.selectedYear)

  const [month, setMonth] = useState(storeMonth)
  const [year, setYear] = useState(storeYear)
  const [dateRangeMode, setDateRangeMode] = useState('month')
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))

  const handleDateChange = useCallback((state) => {
    if (state.month !== undefined) setMonth(state.month)
    if (state.year !== undefined) setYear(state.year)
    if (state.dateRangeMode !== undefined) setDateRangeMode(state.dateRangeMode)
    if (state.dateRangeStart !== undefined) setDateRangeStart(state.dateRangeStart)
    if (state.dateRangeEnd !== undefined) setDateRangeEnd(state.dateRangeEnd)
    if (state.date !== undefined) setDate(state.date)
  }, [])

  const dateProps = {
    mode,
    initialMonth: month,
    initialYear: year,
    onChange: handleDateChange,
    syncToStore,
  }

  return {
    month, year, dateRangeMode, dateRangeStart, dateRangeEnd, date,
    handleDateChange, dateProps
  }
}
