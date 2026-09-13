import type { Response } from 'express'
import type {
  ApiEndpointContract,
  EndpointBody,
  EndpointData,
  EndpointQuery,
} from '@oi-manager/contracts'
import type { ZodIssue, ZodType } from 'zod'

export class ApiContractError extends Error {
  readonly statusCode: 422 | 500
  readonly code: 'API_CONTRACT_REQUEST_INVALID' | 'API_CONTRACT_RESPONSE_INVALID'
  readonly issues: ZodIssue[]

  constructor(
    phase: 'request' | 'response',
    contractKey: string,
    issues: ZodIssue[],
  ) {
    super(`${contractKey} ${phase} contract validation failed`)
    this.name = 'ApiContractError'
    this.statusCode = phase === 'request' ? 422 : 500
    this.code = phase === 'request'
      ? 'API_CONTRACT_REQUEST_INVALID'
      : 'API_CONTRACT_RESPONSE_INVALID'
    this.issues = issues
  }
}

type Contract = ApiEndpointContract<ZodType, ZodType, ZodType>

export function parseContractBody<TContract extends Contract>(
  contract: TContract,
  value: unknown,
): EndpointBody<TContract> {
  const result = contract.body.safeParse(value)
  if (!result.success) throw new ApiContractError('request', contract.key, result.error.issues)
  return result.data as EndpointBody<TContract>
}

export function parseContractQuery<TContract extends Contract>(
  contract: TContract,
  value: unknown,
): EndpointQuery<TContract> {
  const result = contract.query.safeParse(value)
  if (!result.success) throw new ApiContractError('request', contract.key, result.error.issues)
  return result.data as EndpointQuery<TContract>
}

export function sendContractData<TContract extends Contract>(
  response: Response,
  contract: TContract,
  value: unknown,
  status = 200,
) {
  const result = contract.data.safeParse(value)
  if (!result.success) throw new ApiContractError('response', contract.key, result.error.issues)
  return response.status(status).json({ success: true, data: result.data as EndpointData<TContract> })
}

export function sendContractError(error: unknown, response: Response): boolean {
  if (!(error instanceof ApiContractError)) return false
  response.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.statusCode === 422 ? '请求数据不符合接口契约' : '服务器响应不符合接口契约',
    ...(error.statusCode === 422 ? { details: error.issues } : {}),
  })
  return true
}
