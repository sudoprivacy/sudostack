export declare const ZONE_ID_MIN_LEN = 3;
export declare const ZONE_ID_MAX_LEN = 63;
export declare const ZONE_ID_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789-";
export declare const ZONE_ID_NO_LEADING = "-";
export declare const ZONE_ID_NO_TRAILING = "-";
export type ZoneIdRefusal = {
    kind: 'length';
    got: number;
} | {
    kind: 'character';
    got: string;
    at: number;
} | {
    kind: 'leading';
} | {
    kind: 'trailing';
};
export declare function validateZoneId(id: string): ZoneIdRefusal | null;
export declare function describeRefusal(r: ZoneIdRefusal): string;
