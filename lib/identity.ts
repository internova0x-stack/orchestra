import type { Sql } from "./db.ts";
import { bank } from "./bank/index.ts";

// The standard identity check (Guardrails): full name plus two account facts, here the date of
// birth and, for a business, its registration number, or for a personal account the last 4 digits of
// the account number. The answers come from the form and go only to
// this check; the model never sees them. For merchant accounts it also establishes the user is
// an authorised user of that business, since the user row belongs to it.

export interface IdentityAnswers {
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  registration_number: string;
}


/** The user id the answers identify, or null. Never says which answer was wrong. */
export async function checkIdentity(sql: Sql, answers: IdentityAnswers): Promise<string | null> {
  // The bank checks the answers (Bank Connector API, POST /identity/verify) and returns the user it identifies.
  return (await bank(sql).verifyIdentity(answers)).user_id;
}
