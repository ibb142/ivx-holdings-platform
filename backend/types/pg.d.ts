declare module 'pg' {
  export type ClientConfig = {
    host: string; port: number; user: string; password: string; database: string;
    ssl: { rejectUnauthorized: boolean; ca?: string | string[] };
    application_name?: string; connectionTimeoutMillis?: number;
    query_timeout?: number; statement_timeout?: number;
  };
  export class Client {
    constructor(config: ClientConfig);
    on(event: 'error', listener: (error: Error) => void): this;
    connect(): Promise<void>;
    query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
    end(): Promise<void>;
  }
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
      ssl?: { rejectUnauthorized: boolean; ca?: string | string[] };
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
