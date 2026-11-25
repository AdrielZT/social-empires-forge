import { z } from "zod";

export const CommandPayloadSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.unknown()).default([])
});
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export const CommandBatchRequestSchema = z.object({
  pid: z.string().min(1),
  packetId: z.string().min(1),
  tries: z.number().int().min(1).default(1),
  timestamp: z.number(),
  adminMode: z.boolean().optional().default(false),
  commands: z.array(CommandPayloadSchema)
});
export type CommandBatchRequest = z.infer<typeof CommandBatchRequestSchema>;

export const CommandBatchResponseSchema = z.object({
  result: z.enum(["ok", "error", "desync"]),
  packetId: z.string(),
  replayed: z.boolean().default(false),
  appliedCount: z.number().int().min(0),
  error: z.string().optional(),
  serverTime: z.number()
});
export type CommandBatchResponse = z.infer<typeof CommandBatchResponseSchema>;
