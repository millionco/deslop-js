export interface UsedInterface {
  id: number;
}

export interface UnusedInterface {
  name: string;
}

export type UsedAlias = { value: number };

export type UnusedAlias = { code: string };
