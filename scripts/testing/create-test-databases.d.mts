export declare const testDatabaseNames: readonly string[];

export declare function getTestDatabaseAdminUrl(
  environment?: Readonly<Record<string, string | undefined>>,
): string;

export declare function createTestDatabases(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<void>;
