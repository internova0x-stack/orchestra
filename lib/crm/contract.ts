import type { InteractionIn } from "../listen.ts";

// CRM and helpdesk connectors (Tomi, Nov 23: "can we have 4 different connectors?"). One interface, one
// implementation per product: Zendesk, Freshdesk, Salesforce Service Cloud and HubSpot Service Hub, each built to
// that product's published REST API. Orchestra uses a connector to:
// - read a ticket and its thread when the helpdesk says it changed (listen mode);
// - write back what it worked out: tags, priority, the team (a group or queue), an internal note;
// - post a public reply in the ticket (the team's reply written in Orchestra's console);
// - open a ticket for a conversation Orchestra handled and record its outcome (data entry).
// Credentials live only in environment variables; the settings that aren't secret (which team is which group,
// whether to write back) are kept per connector and edited on the API page.

export const CRM_KINDS = ["zendesk", "freshdesk", "salesforce", "hubspot"] as const;
export type CrmKind = (typeof CRM_KINDS)[number];
export const CRM_NAME: Record<CrmKind, string> = { zendesk: "Zendesk", freshdesk: "Freshdesk", salesforce: "Salesforce Service Cloud", hubspot: "HubSpot Service Hub" };

export interface WriteBack {
  tags: string[];
  priority: "urgent" | "high" | "normal";
  /** The helpdesk's id for the team's group or queue (from the connector's mapping), if any. */
  groupId: string | null;
  /** An internal note for the agent: never visible to the customer. */
  note: string;
}

export interface NewTicket {
  subject: string;
  requester: { name: string | null; email: string | null; phone: string | null };
  /** The first, internal description: the case notes. */
  note: string;
  tags: string[];
  priority: "urgent" | "high" | "normal";
  groupId: string | null;
  status: "open" | "solved";
}

export interface CrmConnector {
  readonly kind: CrmKind;
  /** The ticket id in a webhook the helpdesk sends Orchestra (each product's own payload shape). */
  ticketIdFrom(body: unknown): string | null;
  /** The ticket and its thread, in listen mode's shape. Internal notes are left out. */
  fetchTicket(id: string): Promise<InteractionIn | null>;
  writeBack(id: string, w: WriteBack): Promise<void>;
  /** A public reply in the ticket, in the agent's name where the product allows it. */
  reply(id: string, text: string, author: string): Promise<{ public: boolean }>;
  /** Data entry: a ticket recording a conversation Orchestra handled. Returns the new ticket's id. */
  createTicket(t: NewTicket): Promise<string>;
  /** A cheap authenticated read, to check the credentials work ("Reconnect" on the API page). */
  ping(): Promise<void>;
  /** Data entry: an internal note on a ticket (a decision, the outcome), optionally closing it. */
  addNote(id: string, text: string, opts?: { solve?: boolean }): Promise<void>;
}

export class CrmError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
