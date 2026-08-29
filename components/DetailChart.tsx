import { MonitorState, MonitorTarget } from '@/types/config'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

/**
 * 近 12h 延迟曲线（手绘 SVG 动森风，替代原 chart.js Line）：
 * 采样降点到 ≤200，折线 + 淡色面积，非等比缩放时用 non-scaling-stroke 保持线宽。
 */
export default function DetailChart({
  monitor,
  state,
}: {
  monitor: MonitorTarget
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const data = state.latency[monitor.id] ?? []
  if (!data.length) return null

  const step = Math.max(1, Math.ceil(data.length / 200))
  const sampled = data.filter((_, i) => i % step === 0 || i === data.length - 1)
  const times = sampled.map((p) => p.time)
  const pings = sampled.map((p) => Number(p.ping))

  const minT = times[0]
  const maxT = times[times.length - 1]
  const spanT = Math.max(maxT - minT, 1)
  const maxPing = Math.max(...pings.filter((v) => !Number.isNaN(v)), 1)

  // viewBox 0 0 100 100；y 预留顶部/底部各 4 单位
  const pts = sampled
    .map((p, i) => {
      const x = ((p.time - minT) / spanT) * 100
      const y = 100 - 4 - (Number.isNaN(Number(p.ping)) ? 0 : (Number(p.ping) / maxPing) * 92)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const area = `0,100 ${pts} 100,100`

  const fmt = (ts: number) => {
    const dt = new Date(ts * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`
  }
  const lastPing = pings[pings.length - 1]
  const lastLoc = data[data.length - 1].loc

  return (
    <div className={styles.chartBox}>
      <div className={styles.chartTitle}>
        📈 {t('Response times')}
        {!Number.isNaN(lastPing) && (
          <span style={{ marginLeft: 8, color: 'var(--leaf)', fontWeight: 800 }}>
            {lastPing} ms{lastLoc ? ` (${lastLoc})` : ''}
          </span>
        )}
      </div>
      <svg className={styles.chartSvg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <line
          x1="0"
          y1="4"
          x2="100"
          y2="4"
          stroke="rgba(74,59,44,.12)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          y1="52"
          x2="100"
          y2="52"
          stroke="rgba(74,59,44,.1)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={area}
          fill="rgba(143,185,78,.18)"
        />
        <polyline
          points={pts}
          fill="none"
          stroke="#8FB94E"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--ink-soft)',
          fontWeight: 700,
          marginTop: 4,
        }}
      >
        <span>{fmt(minT)}</span>
        <span>{fmt(maxT)}</span>
      </div>
    </div>
  )
}
