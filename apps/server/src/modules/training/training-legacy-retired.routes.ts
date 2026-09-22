import { Router } from 'express'

const router = Router()

const retiredResponse = {
  success: false,
  code: 'TRAINING_LEGACY_API_RETIRED',
  message: '旧训练接口已停用，请使用阶段训练接口',
} as const

router.use('/trainings', (_req, res) => {
  res.status(410).json(retiredResponse)
})

export const retiredTrainingRouter = router
