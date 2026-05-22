export type IntersectWithEmpty = User & {};

export type SelfUnion = User | User;

export type NestedPartial = Partial<Partial<User>>;

export type NestedReadonly = Readonly<Readonly<User>>;

export type PickAll = Pick<User, keyof User>;

export type OmitNever = Omit<User, never>;

export interface EmptyExtends extends User {}

export interface ZodMergedSchemaShape extends ZodSchema.infer<typeof ZodMergedSchemaShape> {}
export const ZodMergedSchemaShape = { ref: 1 };

export interface CheckboxRootProps extends CheckboxPrimitive.Root.Props {}

export interface ButtonAliasProps extends Button.props {}

declare namespace ZodSchema {
  type infer<TParsed> = TParsed;
}
declare namespace CheckboxPrimitive {
  namespace Root {
    interface Props {
      checked: boolean;
    }
  }
}
declare namespace Button {
  interface props {
    onClick: () => void;
  }
}

export interface User {
  id: string;
  name: string;
}

export interface LegitChild extends User {
  extra: boolean;
}

export type LegitUnion = "a" | "b";
