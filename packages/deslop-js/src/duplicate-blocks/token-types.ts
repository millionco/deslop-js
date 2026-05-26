export type CloneTokenKind =
  | "node-enter"
  | "identifier"
  | "string-literal"
  | "numeric-literal"
  | "boolean-literal"
  | "null-literal"
  | "template-literal"
  | "regexp-literal";

export interface SourceToken {
  kind: CloneTokenKind;
  /** AST node type for `node-enter` tokens, raw value for literal/identifier tokens */
  payload: string;
  /** Byte offset of the source span the token represents */
  start: number;
  end: number;
}

export interface HashedToken {
  hash: number;
  /** Index back into the originating SourceToken[] */
  originalIndex: number;
}
