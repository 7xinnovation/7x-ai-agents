/**
 * Has anything about this case's documents changed?
 *
 * The widget fires one turn when a document lands, so the agent confirms what
 * was read and asks for the next thing. It decided that by COUNTING documents,
 * which is blind to the one thing a Replace does: the slot reads "uploaded"
 * before and after, so the count is identical.
 *
 * Reported 15 September. The agent asked for the current MOA, the customer
 * replaced the stale one with it, and the conversation stopped dead -- the
 * agent was never told. It would have happened on every Replace, for every
 * document.
 *
 * A signature over each document's key, status, file name and rejection reason
 * changes whenever any of those does: a first upload, a replacement, a
 * rejection, a rejection cleared by a better copy. Order-independent, because
 * the documents array is rebuilt on every mutation and its order means nothing.
 *
 * The one change it CANNOT see is a file replacing itself under the same name
 * with the same outcome. Nothing in the case distinguishes those -- so the
 * widget also reports an upload it performed itself rather than deducing it.
 */
export interface SignableDocument {
  key: string;
  status: string;
  fileName?: string;
  rejectionReason?: string;
}

/** Separators no file name or rejection reason can contain. */
const FIELD = "\u0000";
const ROW = "\u0001";

export function docSignature(docs: readonly SignableDocument[]): string {
  return docs
    .map((d) => [d.key, d.status, d.fileName ?? "", d.rejectionReason ?? ""].join(FIELD))
    .sort()
    .join(ROW);
}
