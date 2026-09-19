import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workerConfig } from '@/uptime.config'
import { dateInTimeZone } from '@/worker/src/deviceStore'
import { fetchWithUsageKey } from '@/util/usageKey'
import { appLabel, fmtDur } from '@/util/deviceFormat'
import {
  aggregateApps,
  csvCell,
  rangeDays,
  shiftDate,
  usageDays,
  validRange,
  UsageDay,
} from '@/util/deviceStatistics'
import { HourlyChart, UsageResponse } from './DeviceCharts'
import s from '@/styles/device-statistics.module.css'

const COLORS = ['#afd46a', '#f0a852', '#9cd3e8', '#f5d98b', '#f2a9a2']
const PAGE_SIZE = 7
const timeZone = workerConfig.notification?.timeZone ?? 'Asia/Shanghai'

function Apps({ rows }: { rows: UsageDay[] }) {
  const { t } = useTranslation('common')
  const apps = aggregateApps(rows)
  const total = apps.reduce((sum, [, seconds]) => sum + seconds, 0)
  return apps.length ? (
    <div className={s.apps}>
      {apps.map(([app, seconds], index) => (
        <div className={s.app} key={app}>
          <div className={s.appLine}>
            <span className={s.appDot} style={{ background: COLORS[index % COLORS.length] }} />
            <span title={app}>{appLabel(app)}</span>
            <strong>{fmtDur(seconds)}</strong>
          </div>
          <div className={s.appTrack}>
            <div>
              <i
                style={{
                  width: `${(seconds / total) * 100}%`,
                  background: COLORS[index % COLORS.length],
                }}
              />
            </div>
            <span>{((seconds / total) * 100).toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className={s.empty}>{t('stats.noApps')}</p>
  )
}

/** 只有已解锁的设备详情才挂载；日期 key 隔离不同范围的请求与交互状态。 */
export default function DeviceStatistics({
  deviceId,
  now,
  onLock,
}: {
  deviceId: string
  now: number
  onLock: () => void
}) {
  const { t } = useTranslation('common')
  const today = dateInTimeZone(now, timeZone)
  const [range, setRange] = useState(() => ({ start: shiftDate(today, -13), end: today }))
  const [start, setStart] = useState(range.start)
  const [end, setEnd] = useState(range.end)
  const [days, setDays] = useState('14')
  const [error, setError] = useState(false)
  const apply = (from: string, to: string) => {
    if (!validRange(from, to, today)) {
      setError(true)
      return
    }
    setError(false)
    setStart(from)
    setEnd(to)
    setDays(String(rangeDays(from, to)))
    setRange({ start: from, end: to })
  }
  return (
    <section className={s.root}>
      <header className={s.intro}>
        <p>{t('stats.eyebrow')}</p>
        <h1>{t('stats.title')}</h1>
        <span>{t('stats.subtitle')}</span>
      </header>
      <section className={`${s.panel} ${s.range}`} aria-label={t('stats.range')}>
        <div className={s.rangeTop}>
          <strong>{t('stats.rangePrompt')}</strong>
          <div className={s.presets}>
            {[1, 7, 14, 30].map((n) => (
              <button
                type="button"
                key={n}
                aria-pressed={range.end === today && rangeDays(range.start, range.end) === n}
                onClick={() => apply(shiftDate(today, 1 - n), today)}
              >
                {n === 1 ? t('device.tab.today') : t('stats.lastDays', { days: n })}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={range.start === `${today.slice(0, 7)}-01` && range.end === today}
              onClick={() => apply(`${today.slice(0, 7)}-01`, today)}
            >
              {t('stats.month')}
            </button>
          </div>
        </div>
        <form
          className={s.rangeForm}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 30) {
              setError(true)
              return
            }
            apply(start, end)
          }}
        >
          <label>
            {t('stats.start')}
            <input
              type="date"
              required
              value={start}
              max={today}
              onChange={(event) => {
                setStart(event.target.value)
                const n = rangeDays(event.target.value, end)
                setDays(Number.isFinite(n) ? String(n) : '')
              }}
            />
          </label>
          <label>
            {t('stats.end')}
            <input
              type="date"
              required
              value={end}
              max={today}
              onChange={(event) => {
                setEnd(event.target.value)
                const n = rangeDays(start, event.target.value)
                setDays(Number.isFinite(n) ? String(n) : '')
              }}
            />
          </label>
          <label className={s.days}>
            {t('stats.days')}
            <input
              type="number"
              min="1"
              max="30"
              required
              value={days}
              onChange={(event) => {
                const value = event.target.value
                setDays(value)
                const n = Number(value)
                if (Number.isInteger(n) && n >= 1 && n <= 30 && end) setStart(shiftDate(end, 1 - n))
              }}
            />
          </label>
          <button type="submit" className={s.primary}>
            {t('stats.apply')}
          </button>
          <small>
            {t('stats.rangeHint')}
            <br />
            {timeZone}
          </small>
        </form>
        {error && (
          <p className={s.error} role="alert">
            {t('stats.invalidRange')}
          </p>
        )}
      </section>
      <StatisticsRange
        key={`${deviceId}/${range.start}/${range.end}`}
        deviceId={deviceId}
        start={range.start}
        end={range.end}
        today={today}
        now={now}
        onLock={onLock}
      />
      <details className={s.notes}>
        <summary>{t('stats.notes')}</summary>
        <p>{t('stats.noteSampling')}</p>
        <p>{t('stats.noteAverage')}</p>
        <p>{t('stats.noteToday', { timeZone })}</p>
      </details>
    </section>
  )
}

function StatisticsRange({
  deviceId,
  start,
  end,
  today,
  now,
  onLock,
}: {
  deviceId: string
  start: string
  end: string
  today: string
  now: number
  onLock: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const [data, setData] = useState<UsageResponse | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [sort, setSort] = useState('desc')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<UsageDay | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  // 父级随设备状态刷新会重建回调，不能因此清空统计并重复请求。
  const lockRef = useRef(onLock)
  useEffect(() => {
    lockRef.current = onLock
  }, [onLock])
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setError(false)
    setData(null)
    fetchWithUsageKey(
      `/api/device/usage?device_id=${encodeURIComponent(deviceId)}&days=${rangeDays(
        start,
        end
      )}&date=${end}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        if (cancelled) return
        if (response.status === 401) {
          lockRef.current()
          return
        }
        if (!response.ok) throw new Error('usage')
        const result = (await response.json()) as UsageResponse
        if (!cancelled) setData(result)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [deviceId, start, end, retry])
  useEffect(() => {
    if (selected) dialog.current?.showModal()
  }, [selected])
  if (error)
    return (
      <div className={`${s.panel} ${s.empty}`} role="alert">
        <p>{t('stats.loadError')}</p>
        <button type="button" onClick={() => setRetry((n) => n + 1)}>
          {t('stats.retry')}
        </button>
      </div>
    )
  if (!data)
    return (
      <div className={`${s.panel} ${s.empty}`} role="status">
        {t('stats.loading')}
      </div>
    )
  const rows = usageDays(data, start, end)
  const recorded = rows.filter((row) => row.total !== null)
  const total = recorded.reduce((sum, row) => sum + (row.total ?? 0), 0)
  const average = recorded.length ? total / recorded.length : null
  const peak = recorded.reduce<UsageDay | null>(
    (best, row) => (!best || row.total! > best.total! ? row : best),
    null
  )
  const ceiling = Math.max(2, Math.ceil((peak?.total ?? 0) / 7200) * 2)
  const sorted = [...rows].sort((a, b) =>
    sort === 'asc'
      ? a.date.localeCompare(b.date)
      : sort === 'duration'
      ? (b.total ?? -1) - (a.total ?? -1) || b.date.localeCompare(a.date)
      : b.date.localeCompare(a.date)
  )
  const pages = Math.ceil(rows.length / PAGE_SIZE)
  const readout = rows.find((row) => row.date === hovered) ?? rows[rows.length - 1]
  const weekday = (date: string) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`)
    )
  const status = (row: UsageDay) =>
    row.total === null
      ? t('stats.missing')
      : row.date === today
      ? t('stats.ongoing')
      : row.total === 0
      ? t('stats.zero')
      : t('stats.recorded')
  const exportCsv = () => {
    const table = [
      [
        t('stats.date'),
        t('stats.seconds'),
        t('stats.duration'),
        t('stats.topApp'),
        t('stats.appCount'),
        t('stats.status'),
      ],
      ...sorted.map((row) => [
        row.date,
        row.total ?? '',
        row.total === null ? '' : fmtDur(row.total),
        aggregateApps([row])[0]?.[0] ?? '',
        row.total === null ? '' : Object.keys(row.apps).length,
        status(row),
      ]),
    ]
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + table.map((row) => row.map(csvCell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8;',
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `usage_${start}_${end}.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className={s.dashboard}>
      <section className={s.metrics} aria-label={t('stats.summary')}>
        {[
          [
            t('stats.total'),
            recorded.length ? fmtDur(total) : '—',
            t('stats.totalHint', { days: rows.length }),
          ],
          [t('stats.average'), fmtDur(average), t('stats.averageHint', { days: recorded.length })],
          [
            t('stats.peak'),
            fmtDur(peak?.total ?? null),
            peak ? `${peak.date} · ${weekday(peak.date)}` : t('stats.missing'),
          ],
          [
            t('stats.recordedDays'),
            `${recorded.length} / ${rows.length}`,
            t('stats.missingHint', { days: rows.length - recorded.length }),
          ],
        ].map(([label, value, hint]) => (
          <div key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </section>
      <section className={`${s.panel} ${s.chart}`}>
        <div className={s.sectionHead}>
          <div>
            <h2>{t('stats.trend')}</h2>
            <small>
              {start} — {end} · {t('stats.dayCount', { days: rows.length })}
            </small>
          </div>
          <span className={s.legend}>{t('stats.chartLegend')}</span>
        </div>
        <div className={s.chartScroll}>
          <div className={s.plot}>
            <div className={s.axis}>
              {[4, 3, 2, 1, 0].map((n) => (
                <span key={n}>{(ceiling * n) / 4}h</span>
              ))}
            </div>
            <div className={s.grid}>
              {[0, 1, 2, 3, 4].map((n) => (
                <i key={n} />
              ))}
            </div>
            {average !== null && (
              <div
                className={s.average}
                style={{ bottom: `calc(26px + (100% - 26px) * ${average / 3600 / ceiling})` }}
              >
                <span>{t('stats.averageShort', { duration: fmtDur(average) })}</span>
              </div>
            )}
            <div className={s.columns} onMouseLeave={() => setHovered(null)}>
              {rows.map((row, index) => (
                <button
                  type="button"
                  key={row.date}
                  className={row.total === null ? s.missingBar : row.total === 0 ? s.zeroBar : ''}
                  aria-label={`${row.date} · ${
                    row.total === null ? t('stats.missing') : fmtDur(row.total)
                  } · ${t('stats.openDay')}`}
                  onMouseEnter={() => setHovered(row.date)}
                  onFocus={() => setHovered(row.date)}
                  onBlur={() => setHovered(null)}
                  onClick={() => setSelected(row)}
                >
                  <i style={{ height: `${((row.total ?? 0) / 3600 / ceiling) * 100}%` }} />
                  <span>
                    {rows.length <= 14 || index % 5 === 0 || index === rows.length - 1
                      ? row.date.slice(5)
                      : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className={s.readout} aria-live="polite">
          <span>
            {readout.date} · {weekday(readout.date)}
          </span>
          <strong>{readout.total === null ? t('stats.missing') : fmtDur(readout.total)}</strong>
        </div>
        <p className={s.hint}>{t('stats.chartHint')}</p>
      </section>
      <section className={`${s.panel} ${s.appPanel}`}>
        <h2>{t('stats.apps')}</h2>
        <small>{t('stats.appsHint')}</small>
        <Apps rows={rows} />
      </section>
      <section className={`${s.panel} ${s.tablePanel}`}>
        <div className={s.sectionHead}>
          <div>
            <h2>{t('stats.details')}</h2>
            <small>{t('stats.detailsHint')}</small>
          </div>
          <div className={s.actions}>
            <select
              aria-label={t('stats.sort')}
              value={sort}
              onChange={(event) => {
                setSort(event.target.value)
                setPage(1)
              }}
            >
              <option value="desc">{t('stats.sortDesc')}</option>
              <option value="asc">{t('stats.sortAsc')}</option>
              <option value="duration">{t('stats.sortDuration')}</option>
            </select>
            <button type="button" onClick={exportCsv}>
              {t('stats.export')}
            </button>
          </div>
        </div>
        <div className={s.tableScroll}>
          <table>
            <thead>
              <tr>
                {['date', 'duration', 'share', 'topApp', 'appCount', 'status'].map((key) => (
                  <th scope="col" key={key}>
                    {t(`stats.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((row) => (
                <tr key={row.date} onClick={() => setSelected(row)}>
                  <td>
                    <button type="button" aria-label={`${row.date} · ${t('stats.openDay')}`}>
                      {row.date} <small>{weekday(row.date)}</small>
                    </button>
                  </td>
                  <td className={s.duration}>{fmtDur(row.total)}</td>
                  <td>
                    {row.total === null
                      ? '—'
                      : `${total ? ((row.total / total) * 100).toFixed(1) : 0}%`}
                  </td>
                  <td title={aggregateApps([row])[0]?.[0]}>
                    {appLabel(aggregateApps([row])[0]?.[0] ?? null)}
                  </td>
                  <td>{row.total === null ? '—' : Object.keys(row.apps).length}</td>
                  <td>
                    <span
                      className={
                        row.total === null
                          ? s.missingBadge
                          : row.date === today
                          ? s.liveBadge
                          : s.badge
                      }
                    >
                      {status(row)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={s.tableFooter}>
          <span>
            {t('stats.tableCount', {
              days: rows.length,
              from: (page - 1) * PAGE_SIZE + 1,
              to: Math.min(page * PAGE_SIZE, rows.length),
            })}
          </span>
          <div>
            <button
              type="button"
              aria-label={t('stats.prev')}
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              ←
            </button>
            <span>
              {page} / {pages}
            </span>
            <button
              type="button"
              aria-label={t('stats.next')}
              disabled={page === pages}
              onClick={() => setPage((n) => n + 1)}
            >
              →
            </button>
          </div>
        </div>
      </section>
      {start === today && end === today && (
        <section className={`${s.panel} ${s.hourly}`}>
          <h2>{t('device.hourly24')}</h2>
          <HourlyChart hourly={data.hourly_today} now={now} />
        </section>
      )}
      <dialog
        ref={dialog}
        aria-labelledby="usage-day-title"
        className={s.dialog}
        onClose={() => setSelected(null)}
      >
        <div className={s.sectionHead}>
          <h2 id="usage-day-title">
            {selected?.date} · {t('stats.dayReview')}
          </h2>
          <button
            type="button"
            aria-label={t('stats.close')}
            onClick={() => dialog.current?.close()}
          >
            ✕
          </button>
        </div>
        {selected && (
          <>
            <p className={s.dialogTotal}>
              {selected.total === null ? t('stats.missing') : fmtDur(selected.total)}
            </p>
            {selected.total === null ? (
              <p>{t('stats.missingDetail')}</p>
            ) : (
              <Apps rows={[selected]} />
            )}
            {selected.date === today && <p className={s.hint}>{t('stats.todayHint')}</p>}
          </>
        )}
      </dialog>
    </div>
  )
}
