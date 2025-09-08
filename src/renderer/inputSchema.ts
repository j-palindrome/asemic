import { z } from 'zod'

const paramSchema = z.object({
  type: z.literal('number'),
  value: z.number(),
  max: z.number(),
  min: z.number(),
  exponent: z.number().optional().default(1)
})

export const inputSchema = z.object({
  params: z.record(z.string(), paramSchema),
  presets: z.record(z.string(), z.record(z.string(), paramSchema))
})

export type InputSchema = z.infer<typeof inputSchema>
