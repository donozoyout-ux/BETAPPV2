export function databaseErrorMessage(error: unknown): string {
  if (error instanceof AggregateError) {
    const details = error.errors.map((item: unknown) => databaseErrorMessage(item)).filter(Boolean);
    return details.length ? details.join('; ') : error.name;
  }
  if (error instanceof Error) {
    const coded = error as Error & { code?: string };
    return [coded.name, coded.code, coded.message].filter(Boolean).join(' ');
  }
  return String(error);
}
