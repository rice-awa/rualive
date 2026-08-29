import { MonitorState, MonitorTarget } from '@/types/config'
import { monitorColor } from '@/util/monitorFormat'
import { Modal } from 'animal-island-ui'
import { useResizeObserver } from '@mantine/hooks'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'
const moment = require('moment')
require('moment-precise-range-plugin')

/** 条带格 hover 浮窗数据：内容 + 格子在视口中的水平中心/顶部 */
type BarTip = { content: string; cellX: number; cellTop: number }

/**
 * 近 90 天可用率条带（动森风，原 Mantine DetailBar）：
 * 每格一天，hover 显示可用率 / 故障时长，点击当天打开故障详情弹窗。
 */
export default function DetailBar({
  monitor,
  state,
}: {
  monitor: MonitorTarget
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const [barRef, barRect] = useResizeObserver()
  const [modalOpened, setModalOpened] = useState(false)
  const [modalTitle, setModalTitle] = useState('')
  const [modalContent, setModalContent] = useState(<div />)
  const [tip, setTip] = useState<null | BarTip>(null)

  // 页面滚动 / 窗口缩放时隐藏浮窗，避免它脱离对应格子
  useEffect(() => {
    if (!tip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [tip])

  const overlapLen = (x1: number, x2: number, y1: number, y2: number) => {
    return Math.max(0, Math.min(x2, y2) - Math.max(x1, y1))
  }

  const uptimePercentBars = []

  const currentTime = Math.round(Date.now() / 1000)
  const montiorStartTime = state.incident[monitor.id][0].start[0]

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  for (let i = 89; i >= 0; i--) {
    const dayStart = Math.round(todayStart.getTime() / 1000) - i * 86400
    const dayEnd = dayStart + 86400

    const dayMonitorTime = overlapLen(dayStart, dayEnd, montiorStartTime, currentTime)
    let dayDownTime = 0

    let incidentReasons: string[] = []

    for (let incident of state.incident[monitor.id]) {
      const incidentStart = incident.start[0]
      const incidentEnd = incident.end ?? currentTime

      const overlap = overlapLen(dayStart, dayEnd, incidentStart, incidentEnd)
      dayDownTime += overlap

      if (overlap > 0) {
        for (let i = 0; i < incident.error.length; i++) {
          let partStart = incident.start[i]
          let partEnd =
            i === incident.error.length - 1 ? incident.end ?? currentTime : incident.start[i + 1]
          partStart = Math.max(partStart, dayStart)
          partEnd = Math.min(partEnd, dayEnd)

          if (overlapLen(dayStart, dayEnd, partStart, partEnd) > 0) {
            const startStr = new Date(partStart * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            const endStr = new Date(partEnd * 1000).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })
            incidentReasons.push(`[${startStr}-${endStr}] ${incident.error[i]}`)
          }
        }
      }
    }

    const dayPercent = (((dayMonitorTime - dayDownTime) / dayMonitorTime) * 100).toPrecision(4)

    const tooltip = Number.isNaN(Number(dayPercent))
      ? t('No Data')
      : [
          t('percent at date', {
            percent: dayPercent,
            date: new Date(dayStart * 1000).toLocaleDateString(),
          }),
          dayDownTime > 0
            ? t('Down for', {
                duration: moment.preciseDiff(moment(0), moment(dayDownTime * 1000)),
              })
            : '',
        ].join('\n')

    uptimePercentBars.push(
      <div
        key={i}
        className={styles.barCell}
        style={{ background: monitorColor(dayPercent, false) }}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setTip({ content: tooltip, cellX: r.left + r.width / 2, cellTop: r.top })
        }}
        onMouseLeave={() => setTip(null)}
        onClick={() => {
          if (dayDownTime > 0) {
            setModalTitle(
              t('incidents at', {
                name: monitor.name,
                date: new Date(dayStart * 1000).toLocaleDateString(),
              })
            )
            setModalContent(
              <>
                {incidentReasons.map((reason, index) => (
                  <div key={index} style={{ fontSize: 13, lineHeight: 1.8 }}>
                    {reason}
                  </div>
                ))}
              </>
            )
            setModalOpened(true)
          }
        }}
      />
    )
  }

  // 浮窗水平居中于格子上方，并夹紧在视口内（浮窗 max-width 240，半宽留 125 保险）
  let tipLeft = 0
  let tipTop = 0
  if (tip) {
    const clamp = 125
    const vw = typeof window !== 'undefined' ? window.innerWidth : 800
    tipLeft = Math.max(clamp, Math.min(tip.cellX, vw - clamp))
    tipTop = tip.cellTop - 8
  }

  return (
    <>
      <Modal
        open={modalOpened}
        maskClosable
        typewriter={false}
        onClose={() => setModalOpened(false)}
        title={modalTitle}
        footer={null}
      >
        {modalContent}
      </Modal>
      <div
        className={styles.barRow}
        ref={barRef}
        style={{ width: '100%' }}
      >
        {uptimePercentBars.slice(Math.floor(Math.max(9 * 90 - barRect.width, 0) / 9), 90)}
      </div>
      {tip && (
        <div className={styles.barTip} style={{ left: tipLeft, top: tipTop }}>
          {tip.content}
        </div>
      )}
    </>
  )
}
