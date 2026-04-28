/**
 * Zod Validation Middleware
 * zod 校验中间件
 */

import { Request, Response, NextFunction } from 'express'
import { ZodSchema, ZodError } from 'zod'

/**
 * 校验结果类型
 */
export interface ValidatedRequest extends Request {
  validated?: {
    body?: unknown
    query?: unknown
    params?: unknown
  }
}

type ValidatedData = NonNullable<ValidatedRequest['validated']>

/**
 * 创建 body 校验中间件
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result: T = schema.parse(req.body)
      const validated: ValidatedData = (req as ValidatedRequest).validated ?? {}
      validated.body = result
      ;(req as ValidatedRequest).validated = validated
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: '请求参数校验失败',
          errors: error.issues.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        })
      }
      next(error)
    }
  }
}

/**
 * 创建 query 校验中间件
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result: T = schema.parse(req.query)
      const validated: ValidatedData = (req as ValidatedRequest).validated ?? {}
      validated.query = result
      ;(req as ValidatedRequest).validated = validated
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: '请求参数校验失败',
          errors: error.issues.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        })
      }
      next(error)
    }
  }
}

/**
 * 创建 params 校验中间件
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result: T = schema.parse(req.params)
      const validated: ValidatedData = (req as ValidatedRequest).validated ?? {}
      validated.params = result
      ;(req as ValidatedRequest).validated = validated
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: '请求参数校验失败',
          errors: error.issues.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        })
      }
      next(error)
    }
  }
}

/**
 * 组合校验中间件
 */
export function validate(schema: {
  body?: ZodSchema
  query?: ZodSchema
  params?: ZodSchema
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated: ValidatedData = {}

      if (schema.body) {
        validated.body = schema.body.parse(req.body)
      }
      if (schema.query) {
        validated.query = schema.query.parse(req.query)
      }
      if (schema.params) {
        validated.params = schema.params.parse(req.params)
      }

      ;(req as ValidatedRequest).validated = validated
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          message: '请求参数校验失败',
          errors: error.issues.map(e => ({
            path: e.path.join('.'),
            message: e.message
          }))
        })
      }
      next(error)
    }
  }
}