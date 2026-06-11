import { z } from "zod";

const DEFAULT_LINKEDIN_FIFO_SEARCH_URL =
  "https://www.linkedin.com/jobs/search?keywords=%28FIFO%2BOR%2BDIDO%2BOR%2BOil%2BOR%2BGas%2BOR%2BConstruction%2BFifo%2BOR%2BFifo%2BMining%29&location=Australia&geoId=101452733&f_TPR=r86400";

const contentApiConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().optional(),
  CONTENT_API_TOKEN: z.string().min(1).optional(),

  SEEK_FIFO_SEARCH_URL: z.string().url().optional(),
  SEEK_FIFO_MAX_RESULTS: z.coerce.number().int().positive().max(25).optional(),

  LINKEDIN_FIFO_SEARCH_URL: z.string().url().optional(),
  LINKEDIN_FIFO_MAX_RESULTS: z.coerce.number().int().positive().max(25).optional()
});

function formatConfigError(error) {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

function withJobDefaults(cfg) {
  return {
    ...cfg,
    SEEK_FIFO_SEARCH_URL: cfg.SEEK_FIFO_SEARCH_URL || "https://au.seek.com/FIFO-jobs",
    SEEK_FIFO_MAX_RESULTS: cfg.SEEK_FIFO_MAX_RESULTS || 10,
    LINKEDIN_FIFO_SEARCH_URL: cfg.LINKEDIN_FIFO_SEARCH_URL || DEFAULT_LINKEDIN_FIFO_SEARCH_URL,
    LINKEDIN_FIFO_MAX_RESULTS: cfg.LINKEDIN_FIFO_MAX_RESULTS || 10
  };
}

export function getContentApiConfig() {
  const parsed = contentApiConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid content API environment:\n${formatConfigError(parsed.error)}`);
  }

  return {
    ...withJobDefaults(parsed.data),
    CONTENT_API_TOKEN: parsed.data.CONTENT_API_TOKEN || undefined
  };
}

export function getConfig() {
  return getContentApiConfig();
}
