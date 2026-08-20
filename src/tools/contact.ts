import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { freeboxClient } from "../services/freebox-client.js";
import type {
  ContactAddress,
  ContactEmail,
  ContactEntry,
  ContactNumber,
  ContactUrl,
} from "../types.js";
import { sanitizeDisplay } from "../utils/sanitize.js";

type SubKind = "number" | "address" | "url" | "email";
type ContactSubResource =
  | ContactNumber
  | ContactAddress
  | ContactUrl
  | ContactEmail;

// Related entries are exposed under a plural path when listed from a contact
// ("contact/{id}/numbers/") and under a singular top-level path otherwise
// ("number/{id}").
const SUB_COLLECTION: Record<SubKind, string> = {
  number: "numbers",
  address: "addresses",
  url: "urls",
  email: "emails",
};

const SUB_TYPES: Record<SubKind, readonly string[]> = {
  number: ["fixed", "mobile", "work", "fax", "other"],
  address: ["home", "work", "other"],
  url: ["profile", "blog", "site", "other"],
  email: ["home", "work", "other"],
};

const subKindSchema = z
  .enum(["number", "address", "url", "email"])
  .describe("Related entry kind");

const contactIdSchema = z.number().int().nonnegative().describe("Contact ID");
const subIdSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("Related entry ID");

// Fields shared by the create/update tools for related entries. Which ones are
// meaningful depends on the kind; unknown-for-kind fields are rejected.
const subFieldsSchema = {
  type: z
    .string()
    .optional()
    .describe(
      "Entry type. number: fixed|mobile|work|fax|other — address/email: home|work|other — url: profile|blog|site|other"
    ),
  number: z
    .string()
    .optional()
    .describe("Phone number (kind=number) or street number (kind=address)"),
  email: z.string().optional().describe("Email address (kind=email)"),
  url: z.string().optional().describe("URL (kind=url)"),
  street: z.string().optional().describe("Street (kind=address)"),
  street2: z.string().optional().describe("Street line 2 (kind=address)"),
  city: z.string().optional().describe("City (kind=address)"),
  zipcode: z.string().optional().describe("Zip code (kind=address)"),
  country: z.string().optional().describe("Country (kind=address)"),
  is_default: z
    .boolean()
    .optional()
    .describe("Preferred phone number (kind=number)"),
  is_own: z
    .boolean()
    .optional()
    .describe("Freebox owner's own number (kind=number)"),
};

const SUB_ALLOWED_FIELDS: Record<SubKind, readonly string[]> = {
  number: ["type", "number", "is_default", "is_own"],
  address: [
    "type",
    "number",
    "street",
    "street2",
    "city",
    "zipcode",
    "country",
  ],
  url: ["type", "url"],
  email: ["type", "email"],
};

type SubFields = {
  type?: string;
  number?: string;
  email?: string;
  url?: string;
  street?: string;
  street2?: string;
  city?: string;
  zipcode?: string;
  country?: string;
  is_default?: boolean;
  is_own?: boolean;
};

/**
 * Build the API body for a related entry, rejecting fields that do not belong
 * to the requested kind and validating the 'type' enum for that kind.
 */
function buildSubBody(
  kind: SubKind,
  fields: SubFields
): { body: Record<string, unknown> } | { error: string } {
  const allowed = SUB_ALLOWED_FIELDS[kind];
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (!allowed.includes(key)) {
      return {
        error: `Le champ "${key}" ne s'applique pas à kind="${kind}" (champs acceptés : ${allowed.join(", ")}).`,
      };
    }
    body[key] = value;
  }
  if (
    typeof body.type === "string" &&
    !SUB_TYPES[kind].includes(body.type)
  ) {
    return {
      error: `Type "${sanitizeDisplay(body.type, 40)}" invalide pour kind="${kind}" (valeurs acceptées : ${SUB_TYPES[kind].join(", ")}).`,
    };
  }
  return { body };
}

function formatSubResource(kind: SubKind, entry: ContactSubResource): string {
  const type = sanitizeDisplay((entry as { type?: string }).type, 20);
  let value: string;
  switch (kind) {
    case "number":
      value = sanitizeDisplay((entry as ContactNumber).number, 40);
      break;
    case "email":
      value = sanitizeDisplay((entry as ContactEmail).email, 120);
      break;
    case "url":
      value = sanitizeDisplay((entry as ContactUrl).url, 200);
      break;
    case "address": {
      const a = entry as ContactAddress;
      value = [a.number, a.street, a.street2, a.zipcode, a.city, a.country]
        .filter(Boolean)
        .map((part) => sanitizeDisplay(part, 60))
        .join(" ");
      break;
    }
  }
  const flags =
    kind === "number"
      ? [
          (entry as ContactNumber).is_default ? "⭐ default" : null,
          (entry as ContactNumber).is_own ? "🏠 own" : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "";
  return `- **${value || "(vide)"}** — type: ${type || "?"}, id: ${entry.id}${flags ? `, ${flags}` : ""}`;
}

function formatContactSummary(contact: ContactEntry): string {
  const name =
    sanitizeDisplay(contact.display_name) ||
    sanitizeDisplay(`${contact.first_name || ""} ${contact.last_name || ""}`.trim()) ||
    "(sans nom)";
  const company = sanitizeDisplay(contact.company, 60);
  const numbers = (contact.numbers || [])
    .map((n) => sanitizeDisplay(n.number, 40))
    .join(", ");
  const emails = (contact.emails || [])
    .map((e) => sanitizeDisplay(e.email, 120))
    .join(", ");
  return [
    `- 👤 **${name}**${company ? ` (${company})` : ""} — id: ${contact.id}`,
    numbers ? `  - 📞 ${numbers}` : null,
    emails ? `  - ✉️ ${emails}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatContactDetail(contact: ContactEntry): string {
  const lines: string[] = [
    `## Contact ${contact.id}`,
    "",
    `- **Display name**: ${sanitizeDisplay(contact.display_name) || "(vide)"}`,
    `- **First name**: ${sanitizeDisplay(contact.first_name) || "(vide)"}`,
    `- **Last name**: ${sanitizeDisplay(contact.last_name) || "(vide)"}`,
    `- **Company**: ${sanitizeDisplay(contact.company, 60) || "(vide)"}`,
    `- **Notes**: ${sanitizeDisplay(contact.notes, 300) || "(vide)"}`,
    `- **Last update**: ${
      contact.last_update
        ? new Date(contact.last_update * 1000).toISOString().slice(0, 19).replace("T", " ")
        : "unknown"
    }`,
  ];
  const sections: Array<[SubKind, ContactSubResource[] | undefined, string]> = [
    ["number", contact.numbers, "Numéros"],
    ["email", contact.emails, "Emails"],
    ["address", contact.addresses, "Adresses"],
    ["url", contact.urls, "URLs"],
  ];
  for (const [kind, entries, title] of sections) {
    if (!entries || entries.length === 0) continue;
    lines.push("", `### ${title}`, ...entries.map((e) => formatSubResource(kind, e)));
  }
  return lines.join("\n");
}

export function registerContactTools(server: McpServer): void {
  // List contacts
  server.registerTool(
    "freebox_contacts_list",
    {
      title: "List Contacts",
      description: `List the contacts stored in the Freebox address book.
Requires 'contacts' permission.

Args:
  - start (number, optional): Offset in the collection.
  - limit (number, optional): Max contacts to return (-1 means no limit).
  - group_id (number, optional): Only return contacts belonging to this group.

Returns: Array of contacts with id, display_name, first_name, last_name, company, notes, last_update, and their numbers/emails/addresses/urls.`,
      inputSchema: {
        start: z.number().int().nonnegative().optional().describe("Offset"),
        limit: z
          .number()
          .int()
          .min(-1)
          .optional()
          .describe("Max contacts to return (-1 = no limit)"),
        group_id: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe("Filter by contact group ID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { start?: number; limit?: number; group_id?: number }) => {
      try {
        const query = new URLSearchParams();
        if (params.start !== undefined) query.set("start", String(params.start));
        if (params.limit !== undefined) query.set("limit", String(params.limit));
        if (params.group_id !== undefined)
          query.set("group_id", String(params.group_id));
        const qs = query.toString();

        const response = await freeboxClient.apiRequest<ContactEntry[]>(
          `contact/${qs ? `?${qs}` : ""}`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const contacts = response.result || [];
        if (contacts.length === 0) {
          return { content: [{ type: "text", text: "No contact found." }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Contacts (${contacts.length})\n\n${contacts
                .map(formatContactSummary)
                .join("\n")}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Get one contact
  server.registerTool(
    "freebox_contact_get",
    {
      title: "Get Contact",
      description: `Get a single contact by its ID, including its numbers, emails, addresses and URLs.
Requires 'contacts' permission.

Args:
  - id (number): Contact ID.`,
      inputSchema: {
        id: contactIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<ContactEntry>(
          `contact/${encodeURIComponent(String(params.id))}`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const contact = response.result;
        if (!contact) {
          return {
            content: [
              { type: "text", text: `No contact found with ID ${params.id}.` },
            ],
          };
        }
        return {
          content: [{ type: "text", text: formatContactDetail(contact) }],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Create contact
  server.registerTool(
    "freebox_contact_create",
    {
      title: "Create Contact",
      description: `Create a new contact in the Freebox address book.
Phone numbers, emails, addresses and URLs are added afterwards with freebox_contact_subresource_create.
Requires 'contacts' permission.

Args:
  - display_name (string, optional): Name shown in the address book.
  - first_name (string, optional): First name.
  - last_name (string, optional): Last name.
  - company (string, optional): Company name.
  - notes (string, optional): Free-form notes.
  - photo_url (string, optional): Photo URL (may be a data: URI).`,
      inputSchema: {
        display_name: z.string().optional().describe("Display name"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        company: z.string().optional().describe("Company"),
        notes: z.string().optional().describe("Notes"),
        photo_url: z.string().optional().describe("Photo URL"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) body[key] = value;
        }
        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Refusé : indiquez au moins un champ (display_name, first_name, last_name, company, notes ou photo_url).",
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest<ContactEntry>(
          "contact/",
          "POST",
          body
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const contact = response.result;
        return {
          content: [
            {
              type: "text",
              text: `Contact created (id: ${contact?.id}).\n\n${
                contact ? formatContactDetail(contact) : ""
              }`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Update contact
  server.registerTool(
    "freebox_contact_update",
    {
      title: "Update Contact",
      description: `Update an existing contact. Only the specified fields are changed.
Requires 'contacts' permission.

Args:
  - id (number): Contact ID.
  - display_name (string, optional): Name shown in the address book.
  - first_name (string, optional): First name.
  - last_name (string, optional): Last name.
  - company (string, optional): Company name.
  - notes (string, optional): Free-form notes.
  - photo_url (string, optional): Photo URL (may be a data: URI).`,
      inputSchema: {
        id: contactIdSchema,
        display_name: z.string().optional().describe("Display name"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        company: z.string().optional().describe("Company"),
        notes: z.string().optional().describe("Notes"),
        photo_url: z.string().optional().describe("Photo URL"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: Record<string, unknown>) => {
      try {
        const id = params.id as number;
        const body: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(params)) {
          if (key === "id") continue;
          if (value !== undefined) body[key] = value;
        }
        if (Object.keys(body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Refusé : indiquez au moins un champ à modifier.",
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest<ContactEntry>(
          `contact/${encodeURIComponent(String(id))}`,
          "PUT",
          body
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const contact = response.result;
        return {
          content: [
            {
              type: "text",
              text: `Contact ${id} updated.\n\n${
                contact ? formatContactDetail(contact) : ""
              }`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Delete contact
  server.registerTool(
    "freebox_contact_delete",
    {
      title: "Delete Contact",
      description: `Delete a contact and all its numbers, emails, addresses and URLs. This is irreversible.
Requires 'contacts' permission.

Args:
  - id (number): Contact ID.
  - confirm (string): REQUIRED. Deleting a contact also destroys every phone number, email, address and URL attached to it. To proceed, pass confirm="JE-CONFIRME-LA-SUPPRESSION-CONTACT".`,
      inputSchema: {
        id: contactIdSchema,
        confirm: z
          .string()
          .optional()
          .describe(
            "Pass the exact confirmation phrase shown in the tool description to execute this action."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { id: number; confirm?: string }) => {
      try {
        if (params.confirm !== "JE-CONFIRME-LA-SUPPRESSION-CONTACT") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: 'Refusé : cette action est irréversible. Supprimer un contact efface aussi tous ses numéros, emails, adresses et URLs du carnet du foyer. Confirmez avec confirm="JE-CONFIRME-LA-SUPPRESSION-CONTACT".',
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest(
          `contact/${encodeURIComponent(String(params.id))}`,
          "DELETE"
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Contact ${params.id} deleted.` }],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // List related entries of a contact
  server.registerTool(
    "freebox_contact_subresources_list",
    {
      title: "List Contact Numbers/Emails/Addresses/URLs",
      description: `List the phone numbers, emails, postal addresses or URLs attached to a contact.
Requires 'contacts' permission.

Args:
  - contact_id (number): Contact ID.
  - kind (string): One of "number", "address", "url", "email".`,
      inputSchema: {
        contact_id: contactIdSchema,
        kind: subKindSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { contact_id: number; kind: SubKind }) => {
      try {
        const response = await freeboxClient.apiRequest<ContactSubResource[]>(
          `contact/${encodeURIComponent(String(params.contact_id))}/${SUB_COLLECTION[params.kind]}/`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const entries = response.result || [];
        if (entries.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No ${params.kind} entry for contact ${params.contact_id}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## Contact ${params.contact_id} — ${SUB_COLLECTION[params.kind]} (${entries.length})\n\n${entries
                .map((e) => formatSubResource(params.kind, e))
                .join("\n")}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Get a single related entry
  server.registerTool(
    "freebox_contact_subresource_get",
    {
      title: "Get Contact Number/Email/Address/URL",
      description: `Get a single phone number, email, postal address or URL entry by its own ID.
Requires 'contacts' permission.

Args:
  - kind (string): One of "number", "address", "url", "email".
  - id (number): Entry ID (not the contact ID).`,
      inputSchema: {
        kind: subKindSchema,
        id: subIdSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { kind: SubKind; id: number }) => {
      try {
        const response = await freeboxClient.apiRequest<ContactSubResource>(
          `${params.kind}/${encodeURIComponent(String(params.id))}`
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const entry = response.result;
        if (!entry) {
          return {
            content: [
              {
                type: "text",
                text: `No ${params.kind} entry found with ID ${params.id}.`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `## ${params.kind} ${entry.id} (contact ${entry.contact_id})\n\n${formatSubResource(params.kind, entry)}`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Create a related entry
  server.registerTool(
    "freebox_contact_subresource_create",
    {
      title: "Add Contact Number/Email/Address/URL",
      description: `Attach a new phone number, email, postal address or URL to an existing contact.
Requires 'contacts' permission.

Args:
  - kind (string): One of "number", "address", "url", "email".
  - contact_id (number): Contact this entry belongs to.
  - type (string, optional): number: fixed|mobile|work|fax|other — address/email: home|work|other — url: profile|blog|site|other.
  - number (string, optional): Phone number (kind=number) or street number (kind=address).
  - email (string, optional): Email address (kind=email).
  - url (string, optional): URL (kind=url).
  - street / street2 / city / zipcode / country (string, optional): kind=address only.
  - is_default (boolean, optional): Preferred phone number (kind=number).
  - is_own (boolean, optional): Freebox owner's own number (kind=number).`,
      inputSchema: {
        kind: subKindSchema,
        contact_id: contactIdSchema,
        ...subFieldsSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (
      params: { kind: SubKind; contact_id: number } & SubFields
    ) => {
      try {
        const { kind, contact_id, ...fields } = params;
        const built = buildSubBody(kind, fields);
        if ("error" in built) {
          return {
            isError: true,
            content: [{ type: "text", text: `Refusé : ${built.error}` }],
          };
        }
        if (Object.keys(built.body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Refusé : indiquez au moins un champ pour kind="${kind}" (champs acceptés : ${SUB_ALLOWED_FIELDS[kind].join(", ")}).`,
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest<ContactSubResource>(
          `${kind}/`,
          "POST",
          { contact_id, ...built.body }
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const entry = response.result;
        return {
          content: [
            {
              type: "text",
              text: `${kind} entry created for contact ${contact_id} (id: ${entry?.id}).${
                entry ? `\n\n${formatSubResource(kind, entry)}` : ""
              }`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Update a related entry
  server.registerTool(
    "freebox_contact_subresource_update",
    {
      title: "Update Contact Number/Email/Address/URL",
      description: `Update an existing phone number, email, postal address or URL entry. Only the specified fields are changed.
Requires 'contacts' permission.

Args:
  - kind (string): One of "number", "address", "url", "email".
  - id (number): Entry ID (not the contact ID).
  - type (string, optional): number: fixed|mobile|work|fax|other — address/email: home|work|other — url: profile|blog|site|other.
  - number (string, optional): Phone number (kind=number) or street number (kind=address).
  - email (string, optional): Email address (kind=email).
  - url (string, optional): URL (kind=url).
  - street / street2 / city / zipcode / country (string, optional): kind=address only.
  - is_default (boolean, optional): Preferred phone number (kind=number).
  - is_own (boolean, optional): Freebox owner's own number (kind=number).`,
      inputSchema: {
        kind: subKindSchema,
        id: subIdSchema,
        ...subFieldsSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { kind: SubKind; id: number } & SubFields) => {
      try {
        const { kind, id, ...fields } = params;
        const built = buildSubBody(kind, fields);
        if ("error" in built) {
          return {
            isError: true,
            content: [{ type: "text", text: `Refusé : ${built.error}` }],
          };
        }
        if (Object.keys(built.body).length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: "Refusé : indiquez au moins un champ à modifier.",
              },
            ],
          };
        }
        const response = await freeboxClient.apiRequest<ContactSubResource>(
          `${kind}/${encodeURIComponent(String(id))}`,
          "PUT",
          built.body
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        const entry = response.result;
        return {
          content: [
            {
              type: "text",
              text: `${kind} entry ${id} updated.${
                entry ? `\n\n${formatSubResource(kind, entry)}` : ""
              }`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );

  // Delete a related entry
  server.registerTool(
    "freebox_contact_subresource_delete",
    {
      title: "Delete Contact Number/Email/Address/URL",
      description: `Delete a phone number, email, postal address or URL entry from a contact.
Requires 'contacts' permission.

Args:
  - kind (string): One of "number", "address", "url", "email".
  - id (number): Entry ID (not the contact ID).`,
      inputSchema: {
        kind: subKindSchema,
        id: subIdSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: { kind: SubKind; id: number }) => {
      try {
        const response = await freeboxClient.apiRequest(
          `${params.kind}/${encodeURIComponent(String(params.id))}`,
          "DELETE"
        );
        if (!response.success) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Error: ${response.msg || response.error_code}`,
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: `${params.kind} entry ${params.id} deleted.`,
            },
          ],
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${msg}` }],
        };
      }
    }
  );
}
