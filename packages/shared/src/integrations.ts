/**
 * ERP integrations (Configuration → Integrations). One Zoho Books connection holds the
 * organisations of every Zoho entity; each entity is linked to its organisation.
 */
import type { ErpSystem } from './enums';

export interface ZohoLinkDto {
  entityCode: string;
  legalName: string;
  erp: ErpSystem;
  organizationId: string | null;
  organizationName: string | null;
}

export interface ZohoStatusDto {
  /** ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET are set on the server. */
  configured: boolean;
  connected: boolean;
  connectedBy: string | null;
  connectedAt: string | null;
  accountsServer: string | null;
  apiDomain: string | null;
  /** Register this as the redirect URI of the Zoho API client. */
  redirectUri: string;
  canEdit: boolean;
  /** Active Zoho entities (and any entity already linked). */
  links: ZohoLinkDto[];
}

export interface ZohoOrganisationDto {
  organizationId: string;
  name: string;
  currencyCode: string | null;
  /** Entity whose legal name matches this organisation (unambiguous matches only). */
  suggestedFor: string | null;
}

/** On the upload step: can this entity's TB be fetched from its ERP? */
export interface ErpFetchDto {
  provider: ErpSystem;
  available: boolean;
  /** Why not, when it is not available. */
  reason: string | null;
  organizationName: string | null;
}
