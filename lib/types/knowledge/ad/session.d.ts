import { type AdConfig } from './config.js';
import { type AdAction } from './roles.js';
export interface Probe {
    server: string;
    share: string;
    parts: string[];
    directory: boolean;
    digest?: string;
}
export interface Access {
    check(items: readonly Probe[]): Promise<boolean[]>;
    active(): boolean;
}
export declare class AdSessions {
    private config;
    private sessions;
    private attempts;
    private pending;
    private checking;
    private closed;
    private timer;
    constructor(config: AdConfig);
    login(name: string, password: string, peer: string): Promise<{
        token: string;
        expires: number;
        name: string;
    }>;
    get(token: string): {
        name: string;
        expires: number;
        active: () => boolean;
        check: (items: readonly Probe[]) => Promise<boolean[]>;
        permissions: () => Promise<AdAction[]>;
    };
    logout(token: string): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=session.d.ts.map