import { z } from 'zod'

export function apiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data, message: z.string().optional() })
}

export const ApiErrorSchema = z.object({
  success: z.literal(false),
  code: z.string().optional(),
  message: z.string(),
})
export type ApiErrorContract = z.infer<typeof ApiErrorSchema>
