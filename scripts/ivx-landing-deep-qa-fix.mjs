import fs from 'node:fs';

const file = 'expo/ivxholding-landing/index.html';
let html = fs.readFileSync(file, 'utf8');
const original = html;

function replaceIfPresent(label, from, to) {
  const count = html.split(from).length - 1;
  if (count > 1) throw new Error(`${label}: source text occurs ${count} times`);
  if (count === 1) html = html.replace(from, to);
}

replaceIfPresent(
  'remove unverified founding date',
  '    "foundingDate": "2024",\n',
  '',
);

replaceIfPresent(
  'remove unverified social sameAs block',
  '    "sameAs": [\n      "https://twitter.com/ivxholdings",\n      "https://linkedin.com/company/ivxholdings",\n      "https://instagram.com/ivxholdings"\n    ],\n',
  '',
);

replaceIfPresent(
  'remove misleading zero-dollar structured offer',
  '    },\n    "offers": {\n      "@type": "Offer",\n      "name": "Fractional Real Estate Shares",\n      "description": "Request allocation access to published real estate opportunities after investor intake and deal review",\n      "price": "0.00",\n      "priceCurrency": "USD",\n      "availability": "https://schema.org/PreOrder"\n    }\n',
  '    }\n',
);

replaceIfPresent(
  'replace categorical protection claim',
  '          "text": "Each deal is structured as a dedicated LLC entity. Investor funds are held in escrow accounts until deal milestones are met. All properties are title-verified and insured. Note: investments are not FDIC insured and involve risk."',
  '          "text": "Deal structures and protections vary by opportunity. Review the applicable operating agreement, title and insurance information, escrow or payment instructions, and offering documents for the specific deal. Investments are not FDIC insured and involve risk, including possible loss of principal."',
);

replaceIfPresent(
  'make feature escrow claim deal-specific',
  '<h3>Escrow-Structured</h3><p>Deal flow is organized around escrow handling, investor verification, and documented project protections.</p>',
  '<h3>Deal-Specific Payment Structure</h3><p>Payment, escrow, investor-verification, and project-protection terms are reviewed from the documents applicable to each opportunity.</p>',
);

replaceIfPresent(
  'make trust escrow claim deal-specific',
  '<div class="tcard-ttl">Escrow Handling</div><div class="tcard-dsc">Investor payment flow is separated from marketing pages and routed through the platform\'s deal execution process.</div><div class="tcard-tags"><span class="ttag">Escrow</span><span class="ttag">Separated</span><span class="ttag">Structured</span></div>',
  '<div class="tcard-ttl">Deal Payment Review</div><div class="tcard-dsc">Funding and escrow instructions, when applicable, are handled outside marketing content and must be verified against the selected deal documents before funds are sent.</div><div class="tcard-tags"><span class="ttag">Deal-Specific</span><span class="ttag">Verified Instructions</span><span class="ttag">Review</span></div>',
);

// Partner compensation must be agreement-specific. This replacement is safe to repeat.
html = html.replace(/Partner Program([\s\S]{0,180}?)(?:\$[0-9][^<\n]*Per Deal Closed|[0-9]+%[^<\n]*Per Deal Closed|%\s*Per Deal Closed)/i,
  (all, middle) => `Partner Program${middle}Deal-Specific Terms`);

const prohibited = [
  '"foundingDate": "2024"',
  'https://twitter.com/ivxholdings',
  'https://linkedin.com/company/ivxholdings',
  'https://instagram.com/ivxholdings',
  '"price": "0.00"',
  'All properties are title-verified and insured',
  'Investor funds are held in escrow accounts until deal milestones are met',
  '<h3>Escrow-Structured</h3>',
  '<div class="tcard-ttl">Escrow Handling</div>',
  '% Per Deal Closed',
];
for (const text of prohibited) {
  if (html.includes(text)) throw new Error(`truthfulness gate failed: ${text}`);
}
const required = [
  'Deal structures and protections vary by opportunity.',
  'Deal-Specific Payment Structure',
  'Deal Payment Review',
];
for (const text of required) {
  if (!html.includes(text)) throw new Error(`required remediated text missing: ${text}`);
}

if (html !== original) fs.writeFileSync(file, html);
console.log(`LANDING_DEEP_QA_FIX=PASS changed=${html !== original}`);
