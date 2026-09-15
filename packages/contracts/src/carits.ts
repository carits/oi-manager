import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint } from './http'

const CaritsAmountSchema = z.string().regex(/^-?\d+$/)

export const CaritsLedgerEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  source: z.string(),
  referenceId: z.string().nullable().optional(),
  amount: CaritsAmountSchema,
  balanceAfter: CaritsAmountSchema,
  createdAt: DateTimeWireSchema,
})

export const CaritsAccountSchema = z.object({
  currency: z.string(),
  accountStatus: z.enum(['active', 'empty']),
  accountId: z.string().optional(),
  balance: CaritsAmountSchema,
  availableBalance: z.string().regex(/^\d+$/),
  debtBalance: z.string().regex(/^\d+$/),
  createdAt: DateTimeWireSchema.optional(),
  updatedAt: DateTimeWireSchema.optional(),
  items: z.array(CaritsLedgerEntrySchema).optional(),
})
export type CaritsAccount = z.infer<typeof CaritsAccountSchema>

const PlatformCaritsSchema = z.object({
  currency: z.string(),
  summary: z.object({
    rewardedCarits: CaritsAmountSchema,
    rewardCount: z.number().int().nonnegative(),
    spentCarits: CaritsAmountSchema,
    purchasedCredits: z.number().int().nonnegative(),
    purchaseCount: z.number().int().nonnegative(),
  }),
  items: z.array(z.object({
    id: z.string(), ownerType: z.string(), ownerLabel: z.string(),
    balance: CaritsAmountSchema, status: z.string(), createdAt: DateTimeWireSchema,
  })),
  transactions: z.array(z.object({
    id: z.string(), type: z.string(), referenceType: z.string().nullable().optional(),
    referenceId: z.string().nullable().optional(), postedAt: DateTimeWireSchema.nullable().optional(),
    entries: z.array(z.object({ amount: CaritsAmountSchema, ownerType: z.string(), ownerLabel: z.string() })),
  })),
})
export type PlatformCarits = z.infer<typeof PlatformCaritsSchema>

export const CaritsContracts = {
  personalAccount: defineApiEndpoint({ key: 'carits.personal-account', method: 'GET', scope: 'account', data: CaritsAccountSchema }),
  personalTransactions: defineApiEndpoint({ key: 'carits.personal-transactions', method: 'GET', scope: 'account', data: CaritsAccountSchema.extend({ items: z.array(CaritsLedgerEntrySchema) }) }),
  organizationAccount: defineApiEndpoint({ key: 'carits.organization-account', method: 'GET', scope: 'organization', data: CaritsAccountSchema }),
  organizationTransactions: defineApiEndpoint({ key: 'carits.organization-transactions', method: 'GET', scope: 'organization', data: CaritsAccountSchema.extend({ items: z.array(CaritsLedgerEntrySchema) }) }),
  platformAudit: defineApiEndpoint({ key: 'carits.platform-audit', method: 'GET', scope: 'platform', data: PlatformCaritsSchema }),
} as const
