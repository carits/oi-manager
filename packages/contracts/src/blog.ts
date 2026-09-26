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

export const BlogDraftReferenceSchema = z.object({
  type: z.enum(['PROBLEM', 'PROBLEM_REVISION', 'SOLUTION_VERSION', 'CONTEST_STANDING', 'RATING_CHANGE']),
  problemId: z.string().optional(),
  problemRevisionId: z.string().optional(),
  solutionVersionId: z.string().optional(),
  standingSnapshotId: z.string().optional(),
  ratingChangeId: z.string().optional(),
  relationType: z.enum(['PRIMARY_SUBJECT', 'MENTION', 'SOURCE', 'RESULT']),
  displayMode: z.enum(['CARD', 'INLINE', 'COMPACT', 'EMBED', 'HIDDEN_METADATA']),
  positionKey: z.string().optional(),
})

export const BlogDraftClassificationSchema = z.object({
  seriesId: z.string().nullable(),
  tagIds: z.array(z.string()),
  authorTags: z.array(z.string()),
})

export const BlogDraftSchema = z.looseObject({
  revision: z.number().int().positive(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  contentMarkdown: z.string(),
  references: z.array(BlogDraftReferenceSchema),
  classification: BlogDraftClassificationSchema,
  baseVersionId: z.string().nullable().optional(),
  updatedAt: DateTimeWireSchema.optional(),
})

export const BlogVersionSchema = z.looseObject({
  id: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  contentMarkdown: z.string(),
  contentHash: z.string(),
  sourceVersionId: z.string().nullable().optional(),
  status: z.string(),
  visibility: BlogVisibilitySchema,
  classification: BlogClassificationSchema,
  publishedAt: DateTimeWireSchema,
  references: z.array(PublishedBlogReferenceSchema),
})

export const BlogVersionSummarySchema = BlogVersionSchema.pick({
  id: true, version: true, title: true, summary: true, contentHash: true,
  sourceVersionId: true, status: true, visibility: true, classification: true, publishedAt: true,
})

export const BlogManagementPostSchema = z.looseObject({
  id: z.string(),
  slug: z.string(),
  type: BlogPostTypeSchema,
  status: BlogPostStatusSchema,
  visibility: BlogVisibilitySchema,
  organizationId: z.string().nullable().optional(),
  author: z.looseObject({ id: z.string(), username: z.string(), avatar: z.string().nullable().optional() }),
  publishedAt: DateTimeWireSchema.nullable().optional(),
  updatedAt: DateTimeWireSchema,
  currentVersion: BlogVersionSchema.nullable(),
  draft: BlogDraftSchema.nullable().optional(),
})

export const BlogSeriesSummarySchema = z.looseObject({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  visibility: BlogVisibilitySchema,
  organizationId: z.string().nullable().optional(),
  revision: z.number().int().positive(),
  archivedAt: DateTimeWireSchema.nullable().optional(),
  updatedAt: DateTimeWireSchema,
  owner: z.looseObject({ id: z.string(), username: z.string(), avatar: z.string().nullable().optional() }),
  entryCount: z.number().int().nonnegative(),
})
export const BlogSeriesListSchema = paginatedDataSchema(BlogSeriesSummarySchema)
export const BlogSeriesDetailsSchema = BlogSeriesSummarySchema.extend({
  entries: z.array(z.object({
    orderIndex: z.number().int().nonnegative(),
    post: BlogManagementPostSchema,
  })),
})

export const BlogTagListSchema = z.object({
  items: z.array(z.object({ id: z.string(), kind: z.enum(['SYSTEM', 'USER']), name: z.string() })),
  maxPerPost: z.number().int().positive(),
})

const BlogDraftContentInputSchema = z.object({
  title: z.string().max(160),
  summary: z.string().max(1000).nullable(),
  contentMarkdown: z.string(),
  references: z.array(BlogDraftReferenceSchema).max(50),
  classification: BlogDraftClassificationSchema,
})
const BlogSeriesContentInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().max(1000).nullable(),
  visibility: BlogVisibilitySchema,
})

export const BlogManagementContracts = {
  listMine: defineApiEndpoint({
    key: 'blog.management.list-mine',
    method: 'GET',
    scope: 'account',
    query: PaginationQuerySchema.extend({ status: BlogPostStatusSchema.optional() }),
    data: MyBlogListSchema,
  }),
  create: defineApiEndpoint({
    key: 'blog.management.create', method: 'POST', scope: 'account',
    body: BlogDraftContentInputSchema.extend({
      slug: z.string().trim().max(160).optional(),
      type: BlogPostTypeSchema,
      organizationId: z.string().nullable().optional(),
    }),
    data: BlogManagementPostSchema,
  }),
  detail: defineApiEndpoint({
    key: 'blog.management.detail', method: 'GET', scope: 'account', data: BlogManagementPostSchema,
  }),
  updateDraft: defineApiEndpoint({
    key: 'blog.management.update-draft', method: 'PATCH', scope: 'account',
    body: BlogDraftContentInputSchema.extend({ expectedRevision: z.number().int().positive() }),
    data: BlogDraftSchema,
  }),
  publish: defineApiEndpoint({
    key: 'blog.management.publish', method: 'POST', scope: 'account',
    body: z.object({ expectedDraftRevision: z.number().int().positive(), visibility: BlogVisibilitySchema }),
    data: BlogManagementPostSchema,
  }),
  archive: defineApiEndpoint({
    key: 'blog.management.archive', method: 'POST', scope: 'account',
    body: z.undefined(), data: z.object({ id: z.string(), status: z.literal('ARCHIVED') }),
  }),
  versions: defineApiEndpoint({
    key: 'blog.management.versions', method: 'GET', scope: 'account',
    data: z.array(BlogVersionSummarySchema),
  }),
  versionDetail: defineApiEndpoint({
    key: 'blog.management.version-detail', method: 'GET', scope: 'account',
    data: BlogVersionSchema,
  }),
  listSeries: defineApiEndpoint({
    key: 'blog.series.list', method: 'GET', scope: 'account',
    query: PaginationQuerySchema.extend({ includeArchived: z.enum(['true', 'false']).transform(value => value === 'true').or(z.boolean()).optional() }),
    data: BlogSeriesListSchema,
  }),
  seriesDetail: defineApiEndpoint({
    key: 'blog.series.detail', method: 'GET', scope: 'account', data: BlogSeriesDetailsSchema,
  }),
  createSeries: defineApiEndpoint({
    key: 'blog.series.create', method: 'POST', scope: 'account',
    body: BlogSeriesContentInputSchema.extend({ organizationId: z.string().nullable() }),
    data: BlogSeriesSummarySchema,
  }),
  updateSeries: defineApiEndpoint({
    key: 'blog.series.update', method: 'PATCH', scope: 'account',
    body: BlogSeriesContentInputSchema.partial().extend({ expectedRevision: z.number().int().positive() }),
    data: BlogSeriesSummarySchema,
  }),
  reorderSeries: defineApiEndpoint({
    key: 'blog.series.reorder', method: 'PUT', scope: 'account',
    body: z.object({ expectedRevision: z.number().int().positive(), postIds: z.array(z.string()) }),
    data: BlogSeriesSummarySchema,
  }),
  listTags: defineApiEndpoint({
    key: 'blog.tags.list', method: 'GET', scope: 'account',
    query: z.object({ q: z.string().trim().max(30).optional() }),
    data: BlogTagListSchema,
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

export type BlogDraft = z.infer<typeof BlogDraftSchema>
export type BlogVersion = z.infer<typeof BlogVersionSchema>
export type BlogVersionSummary = z.infer<typeof BlogVersionSummarySchema>
export type BlogManagementPost = z.infer<typeof BlogManagementPostSchema>
export type BlogSeriesSummary = z.infer<typeof BlogSeriesSummarySchema>
export type BlogSeriesList = z.infer<typeof BlogSeriesListSchema>
export type BlogSeriesDetails = z.infer<typeof BlogSeriesDetailsSchema>
export type BlogTagList = z.infer<typeof BlogTagListSchema>
