import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDealMatch } from './ivx-deal-matching-engine';
import type { InvestorRecord } from './ivx-investor-crm-store';
import type { ProjectRecord } from './ivx-project-data';

function deal(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'test-deal',
    name: 'Test Deal',
    location: 'Test Location',
    price: '$1,000,000',
    roi: '10%',
    timeline: '12 months',
    ownershipMinimum: '$50,000',
    status: 'active',
    published: true,
    mediaCount: overrides.mediaCount ?? 0,
  };
}

function contact(overrides: Partial<InvestorRecord> = {}): InvestorRecord {
  return {
    id: 'test-investor',
    name: 'Test Investor',
    partyType: 'investor',
    company: 'Test Company',
    email: '',
    phone: '',
    location: '',
    investmentType: 'Family office',
    accreditedStatus: 'unknown',
    preferredMarkets: [],
    preferredAssetClasses: [],
    typicalCheckSize: '',
    investmentTimeline: '',
    notes: '',
    lastContactDate: null,
    leadScore: 0,
    relationshipScore: 0,
    status: 'prospect',
    source: 'owner_entered',
    sourceDetail: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('Deal with videos', () => {
  it('scores higher when videos are present', () => {
    const matchWithVideos = scoreDealMatch(deal({ mediaCount: 2 }), contact());
    const matchWithoutVideos = scoreDealMatch(deal({ mediaCount: 0 }), contact());

    assert(matchWithVideos.matchScore > matchWithoutVideos.matchScore);
  });
});
