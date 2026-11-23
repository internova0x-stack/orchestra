import type { Sql } from "../db.ts";
import type { BankConnector } from "./contract.ts";
import { httpBank } from "./http.ts";
import { simulatedBank } from "./simulated.ts";

export type { BankConnector } from "./contract.ts";

/**
 * The bank Orchestra talks to. With BANK_API_URL and BANK_API_KEY set, any bank that implements the
 * Bank Connector API (over HTTPS); otherwise the simulated bank in this app's database.
 */
export function bank(sql: Sql): BankConnector {
  const url = process.env.BANK_API_URL?.trim();
  const key = process.env.BANK_API_KEY?.trim();
  if (url && key) return httpBank(url, key);
  return simulatedBank(sql);
}
