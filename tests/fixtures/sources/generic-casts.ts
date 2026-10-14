declare const input: unknown;

const asAngle = <number>input;
const asKeyword = input as string;
function first<T>(items: readonly T[]): T | undefined {
  return items[0];
}

export const values = [asAngle, asKeyword, first<string>(["a"])];
