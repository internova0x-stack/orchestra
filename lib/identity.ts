import type { Sql } from "./db.ts";

// The standard identity check (Guardrails): full name plus two account facts, here the date of
// birth and the business's registration number. The answers come from the form and go only to
// this check; the model never sees them. For merchant accounts it also establishes the user is
// an authorised user of that business, since the user row belongs to it.

export interface IdentityAnswers {
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  registration_number: string;
}

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The user id the answers identify, or null. Never says which answer was wrong. */
export async function checkIdentity(sql: Sql, answers: IdentityAnswers): Promise<string | null> {
  const name = letters(answers.full_name ?? "");
  const reg = alnum(answers.registration_number ?? "");
  const dob = (answers.date_of_birth ?? "").slice(0, 10);
  if (!name || !reg || !dob) return null;
  const rows = await sql<{ id: string; full_name: string; dob: string; reg: string }[]>`
    select u.id, u.full_name, to_char(u.date_of_birth, 'YYYY-MM-DD') as dob, b.registration_number as reg
    from business_users u join businesses b on b.id = u.business_id`;
  const user = rows.find((u) => letters(u.full_name) === name && u.dob === dob && alnum(u.reg) === reg);
  return user?.id ?? null;
}
