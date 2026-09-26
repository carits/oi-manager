import { z } from 'zod'
import { DateTimeWireSchema, defineApiEndpoint, paginatedDataSchema, PaginationQuerySchema } from './http'

export const BlogPostTypeSchema = z.enum([
  'ARTICLE',
  'SOLUTION_NOTE',
  'CONTEST_REVIEW',
  'TRAINING_LOG',
  'LEARNING_LOG',
  'TUTORIAL',
  'COLLECTION',
  'ANNOUNCEMENT',
])
export const BlogVisibilitySchema = z.enum(['PRIVATE', 'ORGANIZATION', 'PLATFORM', 'UNLISTED', 'PUBLIC'])
export const BlogPostStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED', 'MODERATION_HOLD', 'REMOVED'])

export const BlogClassificationSchema = z.looseObject({
  tags: z.array(z.looseObject({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['SYSTEM', 'USER']),
  })),
  series: z.looseObject({
    id: z.string(),
    title: z.string(),
    visibility: BlogVisibilitySchema,
    organizationId: z.string().nullable().optional(),
  }).nullable(),
})

export const PublishedBlogReferenceSchema = z.looseObject({
  id: z.string(),
  type: z.enum(['PROBLEM', 'PROBLEM_REVISION', 'SOLUTION_VERSION', 'CONTEST_STANDING', 'RATING_CHANGE', 'SUBMISSION_SNAPSHOT']),
  relationType: z.string(),
  displayMode: z.string(),
  referenceId: z.string(),
  referenceVersionId: z.string().nullable().optional(),
  accessMode: BlogVisibilitySchema,
  status: z.string(),
  snapshot: z.unknown().optional(),
})

export const BlogDiscoveryItemSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  type: BlogPostTypeSchema,
  visibility: BlogVisibilitySchema,
  publishedAt: DateTimeWireSchema.nullable().optional(),
  author: z.looseObject({ username: z.string(), avatar: z.string().nullable().optional() }),
  currentVersion: z.looseObject({
    title: z.string(),
    summary: z.string().nullable().optional(),
    version: z.number(),
    classification: BlogClassificationSchema.nullable().optional(),
  }).nullable(),
})

export const BlogDiscoveryListSchema = paginatedDataSchema(BlogDiscoveryItemSchema)

export const ProblemRelatedBlogSchema = z.looseObject({
  id: z.string(),
  type: BlogPostTypeSchema,
  author: z.looseObject({ username: z.string() }),
  currentVersion: z.looseObject({
    version: z.number().int().positive(),
    title: z.string(),
    summary: z.string().nullable().optional(),
    publishedAt: DateTimeWireSchema,
  }),
})
export const ProblemRelatedBlogListSchema = paginatedDataSchema(ProblemRelatedBlogSchema)

export const BlogDiscoveryDetailSchema = z.looseObject({
  id: z.string(),
  type: BlogPostTypeSchema,
  visibility: BlogVisibilitySchema,
  publishedAt: DateTimeWireSchema.nullable().optional(),
  author: z.looseObject({ username: z.string() }),
  currentVersion: z.looseObject({
    title: z.string(),
    summary: z.string().nullable().optional(),
    version: z.number(),
    contentMarkdown: z.string(),
    classification: BlogClassificationSchema.nullable().optional(),
    references: z.array(PublishedBlogReferenceSchema),
  }).nullable(),
  seriesNavigation: z.looseObject({
    seriesId: z.string(),
    title: z.string(),
    index: z.number(),
    total: z.number(),
    previous: z.looseObject({ id: z.string(), slug: z.string(), title: z.string() }).optional(),
    next: z.looseObject({ id: z.string(), slug: z.string(), title: z.string() }).optional(),
  }).optional(),
})

export const MyBlogListItemSchema = z.looseObject({
  id: z.string(),
  type: BlogPostTypeSchema,
  status: BlogPostStatusSchema,
  visibility: BlogVisibilitySchema,
  updatedAt: DateTimeWireSchema,
  publishedAt: DateTimeWireSchema.nullable().optional(),
  currentVersion: z.looseObject({
    version: z.number().int().positive(),
    title: z.string(),
    summary: z.string().nullable().optional(),
    classification: BlogClassificationSchema.nullable().optional(),
  }).nullable(),
  draft: z.looseObject({
    title: z.string(),
    summary: z.string().nullable().optional(),
    revision: z.number().int().positive(),
  }).nullable().optional(),
})
export const MyBlogListSchema = paginatedDataSchema(MyBlogListItemSchema)

export const BlogManagementContracts = {
  listMine: defineApiEndpoint({
    key: 'blog.management.list-mine',
    method: 'GET',
    scope: 'account',
    query: PaginationQuerySchema.extend({ status: BlogPostStatusSchema.optional() }),
    data: MyBlogListSchema,
  }),
} as const

export const BlogDiscoveryContracts = {
  list: defineApiEndpoint({
    key: 'blog.discovery.list',
    method: 'GET',
    scope: 'account',
    query: PaginationQuerySchema.extend({
      q: z.string().trim().max(200).optional(),
      type: BlogPostTypeSchema.optional(),
    }),
    data: BlogDiscoveryListSchema,
  }),
  detail: defineApiEndpoint({
    key: 'blog.discovery.detail',
    method: 'GET',
    scope: 'account',
    data: BlogDiscoveryDetailSchema,
  }),
  relatedByProblem: defineApiEndpoint({
    key: 'blog.related.problem',
    method: 'GET',
    scope: 'account',
    query: PaginationQuerySchema,
    data: ProblemRelatedBlogListSchema,
  }),
} as const

export type MyBlogListItem = z.infer<typeof MyBlogListItemSchema>
export type MyBlogList = z.infer<typeof MyBlogListSchema>
export type BlogPostStatus = z.infer<typeof BlogPostStatusSchema>
export type BlogDiscoveryItem = z.infer<typeof BlogDiscoveryItemSchema>
export type BlogDiscoveryList = z.infer<typeof BlogDiscoveryListSchema>
export type BlogDiscoveryDetail = z.infer<typeof BlogDiscoveryDetailSchema>
export type ProblemRelatedBlog = z.infer<typeof ProblemRelatedBlogSchema>
export type ProblemRelatedBlogList = z.infer<typeof ProblemRelatedBlogListSchema>
export type BlogPostType = z.infer<typeof BlogPostTypeSchema>
export type BlogVisibility = z.infer<typeof BlogVisibilitySchema>
