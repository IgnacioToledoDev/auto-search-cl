import { z } from "zod";

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();

/** Common listing shape every portal CLI emits. Missing values are null. */
export const VehicleSchema = z.object({
  id: z.string(),
  portal: z.string(),
  url: z.url(),
  title: z.string(),
  make: nullableString,
  model: nullableString,
  version: nullableString,
  year: z.number().int().nullable(),
  km: nullableNumber,
  priceClp: nullableNumber,
  priceUf: nullableNumber,
  currency: nullableString,
  condition: z.enum(["nuevo", "usado"]),
  transmission: nullableString,
  fuel: nullableString,
  bodyType: nullableString,
  sellerType: z.enum(["dealer", "particular"]).nullable(),
  comuna: nullableString,
  region: nullableString,
  plate: nullableString,
  description: nullableString,
  postedDate: nullableString,
  images: z.array(z.string()).optional(),
});

export type Vehicle = z.infer<typeof VehicleSchema>;

export const SearchOutputSchema = z.object({
  meta: z.object({
    total: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    perPage: z.number().int().nonnegative(),
  }),
  results: z.array(VehicleSchema),
});

export type SearchOutput = z.infer<typeof SearchOutputSchema>;
