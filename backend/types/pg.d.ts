declare module 'pg' {
  export type QueryResult<T = Record<string, unknown>> = {
    rows: T[];
  };

  export type PoolClient = {
    query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
    release: () => void;
  };

  export class Pool {
    constructor(config: {
      connectionString: string;
      ssl?: { rejectUnauthorized: boolean };
      application_name?: string;
      max?: number;
      idleTimeoutMillis?: number;
      connectionTimeoutMillis?: number;
    });

    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
  }
}
