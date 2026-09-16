import {
  PlatformBindingContracts,
  type BindingPlatform,
  type EndpointBody,
} from '@oi-manager/contracts'
import apiClient from '@/lib/apiClient'

export const listPlatformBindingPlatforms = () =>
  apiClient.queryContract(PlatformBindingContracts.platforms, '/api/platform-bindings/platforms', { accountScoped: true })

export const getPlatformBindingConfig = (platform: BindingPlatform) =>
  apiClient.queryContract(PlatformBindingContracts.config, `/api/platform-bindings/${platform}/config-schema`, { accountScoped: true })

export const listPlatformBindings = () =>
  apiClient.queryContract(PlatformBindingContracts.list, '/api/platform-bindings', { accountScoped: true })

export const bindPlatform = (platform: BindingPlatform, body: EndpointBody<typeof PlatformBindingContracts.bind>) =>
  apiClient.mutateContract(PlatformBindingContracts.bind, `/api/platform-bindings/${platform}/bind`, body, { accountScoped: true })

export const unbindPlatform = (platform: BindingPlatform) =>
  apiClient.mutateContract(PlatformBindingContracts.unbind, `/api/platform-bindings/${platform}`, {}, { accountScoped: true })
