export type IntersectWithEmpty = User & {};

export type SelfUnion = User | User;

export type NestedPartial = Partial<Partial<User>>;

export type NestedReadonly = Readonly<Readonly<User>>;

export type PickAll = Pick<User, keyof User>;

export type OmitNever = Omit<User, never>;

export interface EmptyExtends extends User {}

export interface User {
  id: string;
  name: string;
}

export interface LegitChild extends User {
  extra: boolean;
}

export type LegitUnion = "a" | "b";
