'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { ChatSticker } from '@oi-manager/contracts'
import styles from './StickerMessage.module.css'

export function StickerMessage({ sticker, fallback }: { sticker: ChatSticker; fallback: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) return <div className={styles.fallback}><span>{fallback}</span><Button variant="ghost" onClick={() => { setAttempt(value => value + 1); setFailed(false) }}>重新加载</Button></div>
  const suffix = attempt ? `?retry=${attempt}` : ''
  return <picture className={styles.picture}>
    <source media="(prefers-reduced-motion: reduce)" srcSet={`${sticker.posterUrl}${suffix}`} />
    <img src={`${sticker.assetUrl}${suffix}`} alt={sticker.label} width={sticker.width} height={sticker.height} onError={() => setFailed(true)} />
  </picture>
}
