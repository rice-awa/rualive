import { MonitorState, MonitorTarget } from '@/types/config'
import MonitorDetail from './MonitorDetail'
import { pageConfig } from '@/uptime.config'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/monitor.module.css'

function countDownCount(state: MonitorState, ids: string[]) {
  let downCount = 0
  for (let id of ids) {
    if (state.incident[id] === undefined || state.incident[id].length === 0) {
      continue
    }

    if (state.incident[id].slice(-1)[0].end === undefined) {
      downCount++
    }
  }
  return downCount
}

function statusMod(state: MonitorState, ids: string[]): string {
  let downCount = countDownCount(state, ids)
  if (downCount === 0) return styles.monUptimeOk
  if (downCount === ids.length) return styles.monUptimeDown
  return styles.monUptimeWarn
}

/** HTTP 监控列表（动森风，原 Mantine Card/Accordion）：分组可折叠，未分组直接铺卡片 */
export default function MonitorList({
  monitors,
  state,
}: {
  monitors: MonitorTarget[]
  state: MonitorState
}) {
  const { t } = useTranslation('common')
  const group = pageConfig.group
  const groupedMonitor = group && Object.keys(group).length > 0

  // Load expanded groups from localStorage
  const savedExpandedGroups = localStorage.getItem('expandedGroups')
  const expandedInitial = savedExpandedGroups
    ? JSON.parse(savedExpandedGroups)
    : Object.keys(group || {})
  const [expandedGroups, setExpandedGroups] = useState<string[]>(expandedInitial)
  useEffect(() => {
    localStorage.setItem('expandedGroups', JSON.stringify(expandedGroups))
  }, [expandedGroups])

  const toggleGroup = (name: string) =>
    setExpandedGroups((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    )

  return (
    <section className={styles.section}>
      {groupedMonitor ? (
        Object.keys(group!).map((groupName) => {
          const ids = group![groupName]
          const expanded = expandedGroups.includes(groupName)
          return (
            <div className={styles.monGroup} key={groupName}>
              <button
                type="button"
                className={styles.monGroupHead}
                onClick={() => toggleGroup(groupName)}
              >
                <span>{groupName}</span>
                <span className={styles.spacer} />
                <span className={statusMod(state, ids)}>
                  {ids.length - countDownCount(state, ids)}/{ids.length} {t('Operational')}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  {expanded ? '▾' : '▸'}
                </span>
              </button>
              {expanded && (
                <div className={styles.monGroupBody}>
                  {monitors
                    .filter((monitor) => ids.includes(monitor.id))
                    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
                    .map((monitor) => (
                      <MonitorDetail key={monitor.id} monitor={monitor} state={state} />
                    ))}
                </div>
              )}
            </div>
          )
        })
      ) : (
        monitors.map((monitor) => (
          <MonitorDetail key={monitor.id} monitor={monitor} state={state} />
        ))
      )}
    </section>
  )
}
