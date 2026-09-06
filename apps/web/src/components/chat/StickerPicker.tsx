'use client'
import { useMemo, useState } from 'react'
import { Smile } from 'lucide-react'
import { IconButton, Popover, usePopoverClose } from '@/components/ui/OverlayPrimitives'
import { Button } from '@/components/ui/Button'
import styles from './StickerPicker.module.css'

export type ChatSticker = { id: string; label: string; assetUrl: string; posterUrl: string; width: number; height: number; animated: boolean }
export type ChatStickerPack = { id: string; key: string; name: string; version: number; stickers: ChatSticker[] }

function PickerContent({ packs, recentIds, sending, onSelect }: { packs: ChatStickerPack[]; recentIds: string[]; sending?: string; onSelect: (sticker: ChatSticker) => Promise<boolean> }) {
  const close = usePopoverClose()
  const stickersById = useMemo(() => new Map(packs.flatMap(pack => pack.stickers).map(sticker => [sticker.id, sticker])), [packs])
  const recent = recentIds.map(id => stickersById.get(id)).filter((item): item is ChatSticker => Boolean(item))
  const [tab, setTab] = useState(recent.length ? 'recent' : packs[0]?.id)
  const stickers = tab === 'recent' ? recent : packs.find(pack => pack.id === tab)?.stickers || []
  return <div className={styles.picker}>
    <div className={styles.tabs} role="tablist" aria-label="表情包">
      {recent.length > 0 && <Button variant="ghost" role="tab" aria-selected={tab === 'recent'} onClick={() => setTab('recent')}>最近</Button>}
      {packs.map(pack => <Button variant="ghost" role="tab" aria-selected={tab === pack.id} key={pack.id} onClick={() => setTab(pack.id)}>{pack.name}</Button>)}
    </div>
    <div className={styles.grid} role="tabpanel">
      {stickers.map(sticker => <Button variant="ghost" iconOnly className={styles.stickerButton} aria-label={`发送表情：${sticker.label}`} title={sticker.label} disabled={Boolean(sending)} key={sticker.id} onClick={async () => { if (await onSelect(sticker)) close() }}>
        <picture><source media="(prefers-reduced-motion: reduce)" srcSet={sticker.posterUrl} /><img src={sticker.assetUrl} alt="" width={sticker.width} height={sticker.height} loading="lazy" /></picture>
        {sending === sticker.id && <span className={styles.sending}>发送中</span>}
      </Button>)}
    </div>
  </div>
}

export function StickerPicker({ packs, recentIds, sending, disabled, onSelect }: { packs: ChatStickerPack[]; recentIds: string[]; sending?: string; disabled?: boolean; onSelect: (sticker: ChatSticker) => Promise<boolean> }) {
  if (!packs.length) return null
  return <Popover side="top" align="start" label="选择表情" trigger={<IconButton variant="ghost" aria-label="选择表情" disabled={disabled}><Smile size={20} /></IconButton>}>
    <PickerContent packs={packs} recentIds={recentIds} sending={sending} onSelect={onSelect} />
  </Popover>
}
