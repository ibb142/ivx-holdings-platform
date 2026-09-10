import fetch from 'node-fetch';

interface Probe {
  name: string;
  url: string;
  expectedCount: number;
}

const probes: Probe[] = [
  { name: 'deals', url: 'https://api.ivxholding.com/api/jv/deals', expectedCount: 9 },
  { name: 'landing_deals', url: 'https://api.ivxholding.com/api/landing/deals', expectedCount: 9 },
  // Add more probes as needed
];

async function probeDeals(): Promise<void> {
  for (const probe of probes) {
    try {
      const response = await fetch(probe.url);
      if (!response.ok) {
        console.error(`Failed to fetch ${probe.name} with status ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== probe.expectedCount) {
        console.error(`Count drift detected in ${probe.name}: expected ${probe.expectedCount}, found ${data.length}`);
        // Implement repair logic
      }
    } catch (error) {
      console.error(`Error fetching ${probe.name}:`, error);
    }
  }
}

probeDeals().catch((error) => console.error('Probe deals failed:', error));
