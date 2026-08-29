import styles from '@/styles/device.module.css'

/** 设备三态（与 util/deviceFormat 的 DeviceState 一致） */
export type CatState = 'online' | 'idle' | 'offline'

const FILL: Record<CatState, { body: string; ear: string }> = {
  online: { body: '#AFD46A', ear: '#F2A9A2' },
  idle: { body: '#CFC7B8', ear: '#E3CFC9' },
  offline: { body: '#A79D8D', ear: '#C9BDB2' },
}

/**
 * 动森风猫猫（移植自 docs/prototype.html 的 catSVG()）：
 * - online：绿猫 + 眼睛高光 + 腮红，整体 bounce + 尾巴摇摆（CSS 动画）
 * - idle：灰猫 + 眯眼 + 头顶 z z（CSS 浮动画）
 * - offline：棕猫 + X 眼 + 光环 + 小翅膀，静态
 * viewBox 0 0 120 112，尺寸由父级 CSS 控制。
 */
export default function DeviceCat({ state }: { state: CatState }) {
  const c = FILL[state]
  const mod =
    state === 'online' ? styles.catOnline : state === 'idle' ? styles.catIdle : styles.catOffline
  const cls = [styles.cat, mod].join(' ')

  return (
    <svg className={cls} viewBox="0 0 120 112" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {state === 'offline' && (
        <ellipse cx="60" cy="12" rx="11" ry="3.6" fill="none" stroke="#E7C766" strokeWidth="3" />
      )}
      {state === 'offline' && (
        <>
          <ellipse
            cx="28"
            cy="84"
            rx="7.5"
            ry="14"
            fill="#FFF9EC"
            stroke="#4A3B2C"
            strokeWidth="3"
            transform="rotate(-30 28 84)"
          />
          <ellipse
            cx="92"
            cy="84"
            rx="7.5"
            ry="14"
            fill="#FFF9EC"
            stroke="#4A3B2C"
            strokeWidth="3"
            transform="rotate(30 92 84)"
          />
        </>
      )}
      {/* 尾巴（独立组，CSS 摇摆） */}
      <g className={styles.tailg}>
        <path d="M88 94 Q110 90 105 66" fill="none" stroke={c.body} strokeWidth="9" strokeLinecap="round" />
      </g>
      {/* 身体 */}
      <ellipse cx="60" cy="90" rx="29" ry="20" fill={c.body} stroke="#4A3B2C" strokeWidth="3.5" />
      <ellipse cx="60" cy="95" rx="13" ry="8" fill="#F7EFDD" opacity=".75" />
      {/* 耳朵 */}
      <path d="M38 34 L33 13 L54 26 Z" fill={c.body} stroke="#4A3B2C" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M82 34 L87 13 L66 26 Z" fill={c.body} stroke="#4A3B2C" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M40 24.5 L36.5 16.5 L45.5 22 Z" fill={c.ear} />
      <path d="M80 24.5 L83.5 16.5 L74.5 22 Z" fill={c.ear} />
      {/* 头 */}
      <circle cx="60" cy="50" r="27" fill={c.body} stroke="#4A3B2C" strokeWidth="3.5" />
      {/* 眼睛 */}
      {state === 'online' && (
        <>
          <circle cx="50" cy="47" r="3.4" fill="#3A2E22" />
          <circle cx="70" cy="47" r="3.4" fill="#3A2E22" />
          <circle cx="51.4" cy="45.6" r="1.2" fill="#fff" />
          <circle cx="71.4" cy="45.6" r="1.2" fill="#fff" />
        </>
      )}
      {state === 'idle' && (
        <>
          <path className={styles.ln} d="M45.5 47 q4.5 4.5 9 0" />
          <path className={styles.ln} d="M65.5 47 q4.5 4.5 9 0" />
        </>
      )}
      {state === 'offline' && (
        <>
          <path className={styles.ln} d="M46.5 44 l7 7 M53.5 44 l-7 7" />
          <path className={styles.ln} d="M66.5 44 l7 7 M73.5 44 l-7 7" />
        </>
      )}
      {/* 鼻子 + 嘴 */}
      <path d="M57.5 53 L62.5 53 L60 56.5 Z" fill="#E58B8B" stroke="#4A3B2C" strokeWidth="1.4" strokeLinejoin="round" />
      <path className={styles.ln} d="M55 60 q2.5 3.2 5 0 q2.5 3.2 5 0" />
      {/* 胡须 */}
      <path className={styles.ln} d="M32 48 L15 44 M32 54 L15 57" />
      <path className={styles.ln} d="M88 48 L105 44 M88 54 L105 57" />
      {/* 腮红 */}
      {state === 'online' && (
        <>
          <circle cx="43" cy="56" r="3.2" fill="#F2A9A2" opacity=".55" />
          <circle cx="77" cy="56" r="3.2" fill="#F2A9A2" opacity=".55" />
        </>
      )}
      {/* 挂机 z z */}
      {state === 'idle' && (
        <>
          <text className={styles.zz} x="87" y="32">
            z
          </text>
          <text className={`${styles.zz} ${styles.zz2}`} x="96" y="21">
            z
          </text>
        </>
      )}
    </svg>
  )
}
