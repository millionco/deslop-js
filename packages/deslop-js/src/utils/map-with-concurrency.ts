import os from "node:os";

const MIN_PARSE_CONCURRENCY = 1;
const MAX_PARSE_CONCURRENCY = 16;

export const resolveAvailableConcurrency = (): number => {
  const available = os.availableParallelism();
  if (!Number.isFinite(available) || available < MIN_PARSE_CONCURRENCY) {
    return MIN_PARSE_CONCURRENCY;
  }
  return Math.max(MIN_PARSE_CONCURRENCY, Math.min(Math.floor(available), MAX_PARSE_CONCURRENCY));
};

export const mapWithConcurrency = async <Input, Output>(
  items: ReadonlyArray<Input>,
  concurrency: number,
  task: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> => {
  const results: Output[] = new Array(items.length);
  if (items.length === 0) return results;

  const workerCount = Math.min(
    Math.max(1, Math.floor(concurrency) || 1),
    items.length,
  );
  let nextIndex = 0;
  const errors: unknown[] = [];

  const runWorker = async (): Promise<void> => {
    while (errors.length === 0) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        errors.push(error);
        return;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  if (errors.length > 0) throw errors[0];
  return results;
};
