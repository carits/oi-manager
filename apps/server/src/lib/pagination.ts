/**
 * 分页工具函数
 *
 * 统一解析分页参数和生成分页响应，避免路由中重复手写分页逻辑
 */

export interface PaginationParams {
  page: number
  pageSize: number
  skip: number
}

export interface PaginatedResponse<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/**
 * 从请求 query 中解析分页参数
 *
 * @param query - req.query 对象
 * @param options.maxPageSize - 最大每页条数，默认 100
 * @param options.defaultPageSize - 默认每页条数，默认 20
 */
export function parsePagination(
  query: Record<string, any>,
  options?: { maxPageSize?: number; defaultPageSize?: number }
): PaginationParams {
  const maxPageSize = options?.maxPageSize ?? 100
  const defaultPageSize = options?.defaultPageSize ?? 20

  const page = Math.max(1, Math.floor(Number(query.page)) || 1)
  const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(query.pageSize)) || defaultPageSize))
  const skip = (page - 1) * pageSize

  return { page, pageSize, skip }
}

/**
 * 生成分页响应结构
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  return {
    data,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  }
}
