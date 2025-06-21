import { z } from 'zod'

export const inputSchema = z.object({
  params: z.record(
    z.string(),
    z.object({
      type: z.literal('number'),
      value: z.number(),
      max: z.number(),
      min: z.number()
    })
  )
})

export type InputSchema = z.infer<typeof inputSchema>

export const WS_PORT = 7004
