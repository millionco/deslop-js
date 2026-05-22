export interface PublicApiType {
  value: number;
}

export const buildInternal = (value: number): { value: number } => ({ value });
