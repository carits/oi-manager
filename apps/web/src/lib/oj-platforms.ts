import {
  OJ_PLATFORM_REGISTRY,
  getOjProblemUrl,
  getOjPlatform,
  getOjPlatformLabel,
  normalizeOjPlatformKey,
} from '@oi-manager/shared'

export interface OjPlatformOption {
  value: string
  label: string
}

export const OJ_PLATFORMS_NO_ALL: OjPlatformOption[] = OJ_PLATFORM_REGISTRY.map(platform => ({
  value: platform.key,
  label: platform.displayName,
}))

export const OJ_PLATFORMS: OjPlatformOption[] = [
  { value: '', label: '全部平台' },
  ...OJ_PLATFORMS_NO_ALL,
]

export const OJ_PLATFORM_LABEL_MAP: Record<string, string> = Object.fromEntries([
  ...OJ_PLATFORM_REGISTRY.map(platform => [platform.key, platform.displayName] as const),
  ...OJ_PLATFORM_REGISTRY.flatMap(platform => platform.aliases.map(alias => [alias, platform.displayName] as const)),
])

export const FETCHABLE_PLATFORMS: OjPlatformOption[] = OJ_PLATFORM_REGISTRY
  .filter(platform => platform.fetch.supported)
  .map(platform => ({ value: platform.key, label: platform.displayName }))

export const PLATFORM_COOKIE_FIELDS: Record<string, Array<{
  key: string
  label: string
  placeholder: string
}>> = {
  luogu: [
    { key: '__client_id', label: '__client_id', placeholder: '例如: 7d78f829...' },
    { key: '_uid', label: '_uid', placeholder: '例如: 401467' },
  ],
}

export function ojPlatformDisplayName(platform: string | null | undefined): string {
  if (!platform) return '其他平台'
  return OJ_PLATFORM_LABEL_MAP[platform] || '其他平台'
}

export function isFetchablePlatform(platform: string): boolean {
  return Boolean(getOjPlatform(platform)?.fetch.supported)
}

export function hasCookieConfig(platform: string): boolean {
  return Boolean(PLATFORM_COOKIE_FIELDS[normalizeOjPlatformKey(platform) || platform])
}

export const SUBMISSION_OJ_OPTIONS: OjPlatformOption[] = OJ_PLATFORMS

export { getOjProblemUrl, getOjPlatform, getOjPlatformLabel, normalizeOjPlatformKey }
