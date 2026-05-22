export interface Identifiable {
  id: string;
}

export type Box<TContent extends Identifiable> = {
  payload: TContent;
};
