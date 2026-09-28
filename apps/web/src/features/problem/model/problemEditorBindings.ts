import { normalizeOjPlatformKey } from '@oi-manager/shared'

export type EditorOjBinding = { platform: string; problemId: string; url?: string }
export type EditorBindingsRead =
  | { ok: true; bindings: EditorOjBinding[] }
  | { ok: false; message: string }

export const UNREADABLE_BINDINGS_MESSAGE = '历史附加来源无法安全读取，已原样保留；本次保存只更新其他字段。请联系管理员审计，暂不能编辑附加来源。'

/** A failed read must never manufacture [] and thereby authorize a destructive write. */
export function readEditorBindings(raw: string | null): EditorBindingsRead {
  if (raw === null) return { ok: true, bindings: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 3) return { ok: false, message: UNREADABLE_BINDINGS_MESSAGE }
    const bindings: EditorOjBinding[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, message: UNREADABLE_BINDINGS_MESSAGE }
      const value = item as Record<string, unknown>
      if (Object.keys(value).some(key => !['platform', 'problemId', 'url'].includes(key))) return { ok: false, message: UNREADABLE_BINDINGS_MESSAGE }
      const platform = typeof value.platform === 'string' ? normalizeOjPlatformKey(value.platform) : null
      if (!platform || typeof value.problemId !== 'string' || !value.problemId.trim() || value.problemId.trim().length > 128
        || (value.url !== undefined && typeof value.url !== 'string')) return { ok: false, message: UNREADABLE_BINDINGS_MESSAGE }
      bindings.push({ platform, problemId: value.problemId.trim(), ...(typeof value.url === 'string' ? { url: value.url } : {}) })
    }
    return { ok: true, bindings }
  } catch {
    return { ok: false, message: UNREADABLE_BINDINGS_MESSAGE }
  }
}
