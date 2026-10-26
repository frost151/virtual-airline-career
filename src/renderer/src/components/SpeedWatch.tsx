import { useEffect, useRef } from 'react'
import { Notification } from '@mantine/core'
import { FL100_SPEED_LIMIT, OVERSPEED_GRACE_S, SPEED_TOLERANCE_KT } from '@shared/sim'
import { useTrackerState } from '../hooks'

/** Короткий двойной сигнал через Web Audio — без звуковых файлов. */
function beep(): void {
  try {
    const ctx = new AudioContext()
    for (const [at, freq] of [
      [0, 880],
      [0.18, 880]
    ]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'square'
      gain.gain.setValueAtTime(0.08, ctx.currentTime + at)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.12)
      osc.connect(gain).connect(ctx.destination)
      osc.start(ctx.currentTime + at)
      osc.stop(ctx.currentTime + at + 0.13)
    }
    setTimeout(() => void ctx.close(), 600)
  } catch {
    // Звук недоступен — останется только сообщение на экране.
  }
}

/**
 * Следит за скоростью ниже FL100 во время полёта: выше 250 узлов — сигнал,
 * выше 260 — обратный отсчёт до штрафа (OVERSPEED_GRACE_S секунд, как в правиле трекера).
 */
export function SpeedWatch() {
  const state = useTrackerState()
  const s = state?.active ? state.sample : null
  const over = !!s && !s.onGround && !s.paused && s.altFt < 10000 && s.iasKt > FL100_SPEED_LIMIT
  const hard = over && s!.iasKt > FL100_SPEED_LIMIT + SPEED_TOLERANCE_KT
  const hardSince = useRef<number | null>(null)
  const wasOver = useRef(false)

  useEffect(() => {
    if (over && !wasOver.current) beep()
    wasOver.current = over
  }, [over])

  if (!hard) hardSince.current = null
  else hardSince.current ??= s!.t
  if (!over) return null

  const left = hardSince.current === null ? null : Math.max(0, Math.ceil(OVERSPEED_GRACE_S - (s!.t - hardSince.current) / 1000))
  return (
    <Notification
      color={hard ? 'red' : 'yellow'}
      title={`Скорость ${Math.round(s!.iasKt)} узлов ниже FL100`}
      withCloseButton={false}
      style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 400, width: 340 }}
    >
      {left === null
        ? `Снизьте до ${FL100_SPEED_LIMIT}. Допуск — до ${FL100_SPEED_LIMIT + SPEED_TOLERANCE_KT} узлов.`
        : left > 0
          ? `Снизьте до ${FL100_SPEED_LIMIT} — штраф через ${left} с.`
          : 'Нарушение записано в журнал полёта.'}
    </Notification>
  )
}
