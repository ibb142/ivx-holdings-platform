import fs from 'node:fs';

const file = 'expo/ivxholding-landing/index.html';
let html = fs.readFileSync(file, 'utf8');
const original = html;

function replaceOnce(label, from, to) {
  const i = html.indexOf(from);
  if (i < 0) throw new Error(`${label}: source text not found`);
  if (html.indexOf(from, i + from.length) >= 0) throw new Error(`${label}: source text occurs more than once`);
  html = html.slice(0, i) + to + html.slice(i + from.length);
}

replaceOnce(
  'remove unverified founding date',
  '    "foundingDate": "2024",\n',
  '',
);

replaceOnce(
  'remove unverified social sameAs block',
  '    "sameAs": [\n      "https://twitter.com/ivxholdings",\n      "https://linkedin.com/company/ivxholdings",\n      "https://instagram.com/ivxholdings"\n    ],\n',
  '',
);

replaceOnce(
  'remove misleading zero-dollar structured offer',
  '    },\n    "offers": {\n      "@type": "Offer",\n      "name": "Fractional Real Estate Shares",\n      "description": "Request allocation access to published real estate opportunities after investor intake and deal review",\n      "price": "0.00",\n      "priceCurrency": "USD",\n      "availability": "https://schema.org/PreOrder"\n    }\n',
  '    }\n',
);

replaceOnce(
  'replace categorical protection claim',
  '          "text": "Each deal is structured as a dedicated LLC entity. Investor funds are held in escrow accounts until deal milestones are met. All properties are title-verified and insured. Note: investments are not FDIC insured and involve risk."',
  '          "text": "Deal structures and protections vary by opportunity. Review the applicable operating agreement, title and insurance information, escrow or payment instructions, and offering documents for the specific deal. Investments are not FDIC insured and involve risk, including possible loss of principal."',
);

// Partner compensation must be deal-specific unless an approved agreement states a fixed amount.
html = html.replace(/(<[^>]*>[^<]*Partner Program[^<]*<\/[^>]+>[\s\S]{0,500}?)(\$[0-9][^<]*Per Deal Closed|[0-9]+%[^<]*Per Deal Closed|%\s*Per Deal Closed)/i,
  (all, before) => `${before}Deal-Specific Terms`);

const prohibited = [
  '"foundingDate": "2024"',
  'https://twitter.com/ivxholdings',
  'https://linkedin.com/company/ivxholdings',
  'https://instagram.com/ivxholdings',
  '"price": "0.00"',
  'All properties are title-verified and insured',
  'Investor funds are held in escrow accounts until deal milestones are met',
];
for (const text of prohibited) {
  if (html.includes(text)) throw new Error(`truthfulness gate failed: ${text}`);
}
if (!html.includes('Deal structures and protections vary by opportunity.')) {
  throw new Error('replacement FAQ protection language missing');
}
if (html === original) throw new Error('no landing changes produced');
fs.writeFileSync(file, html);
console.log('LANDING_DEEP_QA_FIX=PASS');
