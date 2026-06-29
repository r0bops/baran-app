export interface FoldResult {
    tier: number;
    tierName: string;
    verified: boolean;
    disputed: boolean;
    locationVerified: boolean;
    note?: string;
}
export declare function fold(report: Record<string, unknown>, attestations: Record<string, unknown>[], identities: Record<string, Uint8Array>, subjectDeviceId: string | null): FoldResult;
