import type { UsageResponse } from '@/components/DeviceCharts'

const DAY = 86400000
export type UsageDay = { date: string; total: number | null; apps: Record<string, number> }
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)
export const rangeDays = (start: string, end: string) =>
  Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1

export function validRange(start: string, end: string, today: string): boolean {
  const validDate = (date: string) => {
    const timestamp = Date.parse(`${date}T00:00:00Z`)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      Number.isFinite(timestamp) &&
      new Date(timestamp).toISOString().slice(0, 10) === date
    )
  }
  const days = rangeDays(start, end)
  return validDate(start) && validDate(end) && days >= 1 && days <= 30 && end <= today
}

/** 缺失日期保留 null，不能根据缺少心跳推断设备未使用。 */
export function usageDays(data: UsageResponse, start: string, end: string): UsageDay[] {
  const byDate = new Map(data.daily.map((day) => [day.date, day]))
  return Array.from({ length: rangeDays(start, end) }, (_, index) => {
    const date = shiftDate(start, index)
    const day = byDate.get(date)
    return { date, total: day?.total_seconds ?? null, apps: day?.by_app ?? {} }
  })
}

export function aggregateApps(days: UsageDay[]): [string, number][] {
  const result = new Map<string, number>()
  for (const day of days) {
    for (const [app, seconds] of Object.entries(day.apps)) {
      result.set(app, (result.get(app) ?? 0) + seconds)
    }
  }
  return Array.from(result)
    .filter(([, seconds]) => seconds > 0)
    .sort((a, b) => b[1] - a[1])
}

/** 防止应用名称被电子表格当作公式执行，同时保留引号与换行。 */
export function csvCell(value: string | number): string {
  const text = String(value)
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
