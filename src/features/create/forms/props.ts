import type { PayloadForm, PayloadKind } from '@/domain/payload';

/**
 * What every form on the Create screen is handed.
 *
 * The forms hold nothing: the draft lives in the shell, one per kind, and a
 * form's only job is to show it and to hand back the next one. Everything that
 * decides — what is valid, what the code will carry, what the screen says about
 * it — is the domain's.
 */

/** The form of one kind, picked out of the union the shell holds. */
export type FormOf<K extends PayloadKind> = Extract<PayloadForm, { kind: K }>;

export interface FieldsProps<K extends PayloadKind> {
  form: FormOf<K>;
  onChange: (form: PayloadForm) => void;
  /** The field the builder refused, if any. It is the one marked invalid. */
  invalid: string | undefined;
  /**
   * A remark the builder attached to an accepted payload — what the chosen
   * format cannot carry, in the domain's words. Only the kinds whose format is
   * a choice can have one; the rest never see it.
   */
  note?: string | undefined;
}
