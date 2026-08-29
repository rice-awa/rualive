import { useRef, useState } from 'react'
import { Button, Input, Modal, Typewriter } from 'animal-island-ui'
import { useTranslation } from 'react-i18next'
import styles from '@/styles/device.module.css'

type Props = {
  open: boolean
  onClose: () => void
  /** 解锁成功回调（key 已通过服务端验证，父级负责落盘 + 刷新 + toast） */
  onUnlocked: (key: string) => void
}

/**
 * 密钥解锁弹窗（PRD F7）。
 * 验证方式：GET /api/device/usage?days=1 带 X-API-Key —— 200 视为有效（会落盘缓存），
 * 401 显示错误 + 抖动（不会落盘）。与 status 接口不同，usage 接口对错误密钥明确返回 401。
 */
export default function DeviceUnlockModal({ open, onClose, onUnlocked }: Props) {
  const { t } = useTranslation('common')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [err, setErr] = useState(false)
  /** 递增以强制重挂载内容区，重播 shake 动画 */
  const [shakeKey, setShakeKey] = useState(0)
  /** 递增以触发 Typewriter 重新播放 */
  const [openCount, setOpenCount] = useState(0)
  const busyRef = useRef(false)

  const submit = async () => {
    if (busyRef.current) return
    busyRef.current = true
    try {
      const res = await fetch('/api/device/usage?days=1', {
        headers: key ? { 'X-API-Key': key } : undefined,
      })
      if (res.status === 200) {
        setErr(false)
        setKey('')
        onUnlocked(key)
      } else {
        setErr(true)
        setShakeKey((k) => k + 1)
      }
    } catch {
      setErr(true)
      setShakeKey((k) => k + 1)
    } finally {
      busyRef.current = false
    }
  }

  return (
    <Modal
      open={open}
      maskClosable
      // UI 库 Modal 的 typewriter 默认会对 body 也做逐字 reveal：
      // 小字/按钮要等打字机打完才完整出现，且 body 随文字变宽把输入框（width:100%）拉长。
      // 关闭它，只保留 title 里的 Typewriter。
      typewriter={false}
      onClose={() => {
        if (!busyRef.current) onClose()
      }}
      title={
        <Typewriter trigger={openCount}>{t('device.unlockTitle')}</Typewriter>
      }
      footer={null}
    >
      <div key={shakeKey} className={err ? styles.shake : undefined}>
        <Input
          type={showKey ? 'text' : 'password'}
          placeholder={t('device.unlockPlaceholder')}
          autoComplete="off"
          value={key}
          size="middle"
          suffix={
            <button
              type="button"
              className={styles.eyeBtn}
              title={showKey ? t('device.hideKey') : t('device.showKey')}
              aria-label={showKey ? t('device.hideKey') : t('device.showKey')}
              onClick={() => setShowKey((s) => !s)}
            >
              {showKey ? '🙈' : '👁️'}
            </button>
          }
          onChange={(e) => {
            setKey(e.target.value)
            if (err) setErr(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {err && <div className={styles.modalErr}>{t('device.unlockError')}</div>}
        <div className={styles.modalHint}>{t('device.unlockHint')}</div>
        <div className={styles.modalBtns}>
          <Button type="default" size="small" onClick={() => !busyRef.current && onClose()}>
            {t('device.unlockCancel')}
          </Button>
          <Button type="primary" size="small" onClick={submit}>
            {t('device.unlockSubmit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
