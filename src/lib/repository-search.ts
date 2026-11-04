type RepositoryOption = { id: number; fullName: string };
const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Every search term must appear in the item's text. Keeps list order and returns at most `limit` matches. */
export function searchByText<T>(items: readonly T[], query: string, text: (item: T) => string, limit = 80) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const matches: T[] = [];
  let total = 0;
  for (const item of items) {
    const name = normalize(text(item));
    if (!terms.every(term => name.includes(term))) continue;
    total++;
    if (matches.length < limit) matches.push(item);
  }
  return { matches, total };
}

export function searchRepositories<T extends RepositoryOption>(repositories: T[], query: string, limit = 80) {
  return searchByText(repositories, query, repository => repository.fullName, limit);
}
