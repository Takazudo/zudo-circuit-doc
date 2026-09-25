import { decodeModelDescriptor, encodeModelDescriptor, type ModelViewerDescriptor } from "./model-descriptor.ts";

export const FOOTPRINT_ASSET_BASE = "/assets/component-previews/footprints/";

export type ComponentReferencesDescriptor = {
  readonly version: 1;
  readonly document: {
    readonly label: string;
    readonly title: string;
    readonly authority: string;
    readonly availability: string;
    readonly url: string;
  };
  readonly footprint: {
    readonly name: string;
    readonly assetUrl: string;
  };
  /** Kept encoded so the same validated descriptor reaches the client island. */
  readonly modelDescriptor: string;
};

const HEX = /^(?:[0-9a-f]{2})+$/u;
const DOCUMENT_LABELS = new Set(["Datasheet PDF", "Specification PDF", "Mechanical drawing PDF"]);
const SAFE_FOOTPRINT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+(),/-]*$/u;
const SAFE_FOOTPRINT_ASSET = /^\/assets\/component-previews\/footprints\/[A-Za-z0-9][A-Za-z0-9._+-]*\.svg$/u;

export function footprintAssetUrl(footprintName: string): string {
  const assetUrl = `${FOOTPRINT_ASSET_BASE}${footprintName}.svg`;
  if (!SAFE_FOOTPRINT_ASSET.test(assetUrl)) throw new Error("Footprint preview asset path is unsafe");
  return assetUrl;
}

export function encodeComponentReferencesDescriptor(descriptor: ComponentReferencesDescriptor): string {
  assertComponentReferencesDescriptor(descriptor);
  return [...new TextEncoder().encode(JSON.stringify(descriptor))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function decodeComponentReferencesDescriptor(encoded: string): ComponentReferencesDescriptor {
  if (!HEX.test(encoded) || encoded.length > 8192) throw new Error("Invalid component references descriptor encoding");
  const bytes = new Uint8Array(encoded.length / 2);
  for (let index = 0; index < encoded.length; index += 2) {
    bytes[index / 2] = Number.parseInt(encoded.slice(index, index + 2), 16);
  }
  const candidate: unknown = JSON.parse(new TextDecoder().decode(bytes));
  assertComponentReferencesDescriptor(candidate);
  return candidate;
}

export function createComponentReferencesDescriptor(input: {
  readonly document: ComponentReferencesDescriptor["document"];
  readonly footprintName: string;
  readonly model: ModelViewerDescriptor;
}): ComponentReferencesDescriptor {
  return {
    version: 1,
    document: input.document,
    footprint: { name: input.footprintName, assetUrl: footprintAssetUrl(input.footprintName) },
    modelDescriptor: encodeModelDescriptor(input.model),
  };
}

export function assertComponentReferencesDescriptor(value: unknown): asserts value is ComponentReferencesDescriptor {
  if (typeof value !== "object" || value === null) throw new Error("Component references descriptor must be an object");
  const descriptor = value as Record<string, unknown>;
  if (Object.keys(descriptor).sort().join(",") !== "document,footprint,modelDescriptor,version" || descriptor.version !== 1) {
    throw new Error("Component references descriptor has unexpected fields");
  }
  assertDocument(descriptor.document);
  assertFootprint(descriptor.footprint);
  if (typeof descriptor.modelDescriptor !== "string") throw new Error("Component references model descriptor is invalid");
  decodeModelDescriptor(descriptor.modelDescriptor);
}

function assertDocument(value: unknown): asserts value is ComponentReferencesDescriptor["document"] {
  if (typeof value !== "object" || value === null) throw new Error("Component reference document is invalid");
  const document = value as Record<string, unknown>;
  if (Object.keys(document).sort().join(",") !== "authority,availability,label,title,url") {
    throw new Error("Component reference document has unexpected fields");
  }
  if (typeof document.label !== "string" || !DOCUMENT_LABELS.has(document.label)) {
    throw new Error("Component reference document label is not reviewed");
  }
  if (typeof document.title !== "string" || !isDisplayText(document.title)) {
    throw new Error("Component reference document title is unsafe");
  }
  if (typeof document.authority !== "string" || !isDisplayText(document.authority)) {
    throw new Error("Component reference document authority is unsafe");
  }
  if (typeof document.availability !== "string" || !isDisplayText(document.availability)) {
    throw new Error("Component reference document availability is unsafe");
  }
  if (typeof document.url !== "string" || !isSafeHttpUrl(document.url)) {
    throw new Error("Component reference document URL is unsafe");
  }
}

function assertFootprint(value: unknown): asserts value is ComponentReferencesDescriptor["footprint"] {
  if (typeof value !== "object" || value === null) throw new Error("Component reference footprint is invalid");
  const footprint = value as Record<string, unknown>;
  if (
    Object.keys(footprint).sort().join(",") !== "assetUrl,name" ||
    typeof footprint.name !== "string" ||
    !SAFE_FOOTPRINT_NAME.test(footprint.name) ||
    typeof footprint.assetUrl !== "string" ||
    !SAFE_FOOTPRINT_ASSET.test(footprint.assetUrl) ||
    footprint.assetUrl !== footprintAssetUrl(footprint.name)
  ) {
    throw new Error("Component reference footprint contains an unsafe value");
  }
}

function isSafeHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > 2000 || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  // The source URL has already passed `classifyUrl` during projection. The
  // SSR sandbox does not expose the URL constructor, so this second boundary
  // checks the dangerous distinctions directly instead of reparsing it there.
  const authority = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/u.exec(value)?.[1];
  return authority !== undefined && authority !== "" && !authority.includes("@");
}

/** Evidence strings are already SafeText in the renderer; this decoder only
 * needs to reject empty/control-filled external input before Preact escapes it. */
function isDisplayText(value: string): boolean {
  return value.length > 0 && value.length <= 1000 && !/[\p{Cc}\p{Cf}]/u.test(value);
}
