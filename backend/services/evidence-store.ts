// Evidence storage function
type EvidenceEntry = {
  engine: string;
  result: string;
  timestamp: string;
};

const evidenceDatabase: EvidenceEntry[] = [];

export function storeEvidence(engine: string, result: string): void {
  const entry: EvidenceEntry = {
    engine,
    result,
    timestamp: new Date().toISOString(),
  };
  evidenceDatabase.push(entry);
}