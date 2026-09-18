export declare const RESOURCE_REF_API_VERSION: "common.sudo.dev/v1";
export declare const RESOURCE_REF_KIND: "ResourceRef";
export declare const MAX_RESOURCE_REF_JSON_BYTES: number;
export declare const MAX_EXTENSION_DEPTH: number;
export type JsonValue = null | boolean | string | number | JsonValue[] | {
    [key: string]: JsonValue;
};
export interface ResourceRef {
    api_version: typeof RESOURCE_REF_API_VERSION;
    kind: typeof RESOURCE_REF_KIND;
    zone_id: string;
    path: string;
    version?: string;
    digest?: string;
    media_type?: string;
    size_bytes?: string;
    [key: string]: JsonValue | undefined;
}
export interface ResourceRefValidationIssue {
    category: string;
    path: string;
    keyword: string;
    message: string;
}
export declare class ResourceRefValidationError extends Error {
    readonly issues: readonly ResourceRefValidationIssue[];
    constructor(issues: readonly ResourceRefValidationIssue[]);
}
export declare function validateResourceRef(value: unknown): ResourceRefValidationIssue[];
export declare function parseResourceRefJson(input: string | Uint8Array): Readonly<ResourceRef>;
export declare function assertResourceRef(value: unknown): asserts value is ResourceRef;
export declare function isResourceRef(value: unknown): value is ResourceRef;
export declare function serializeResourceRef(value: ResourceRef): string;
export declare function getResourceRefSchema(): Record<string, unknown>;
