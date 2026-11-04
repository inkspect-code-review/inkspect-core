export type ReviewCostCall = {
  id: string; category: 'model' | 'embedding' | 'rerank'; model: string; region: string;
  status: 'measured' | 'estimated' | 'unmeasured'; request_id?: string; measurement_source?: string;
  input_tokens?: number; output_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number;
  search_units?: number; documents?: number; cost_nano_usd: string | null; estimated_cost_nano_usd?: string;
  rates?: Record<string, number>; reason?: string;
};
export type ReviewCost = {
  version: 1; currency: 'USD'; basis: 'provider_list_price'; pricing_date: string;
  complete: boolean; total_nano_usd: string | null; measured_nano_usd: string;
  unmeasured_calls: number; estimated_nano_usd: string; calls: ReviewCostCall[];
  components: { category: ReviewCostCall['category']; calls: number; complete: boolean; cost_nano_usd: string | null; measured_nano_usd: string; estimated_nano_usd: string }[];
};
