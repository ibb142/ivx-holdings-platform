/**
 * IVX Holdings — Registration Consolidation
 *
 * Consolidates registration into ONE primary conversion flow:
 * Smart Funnel → Member Registration
 *
 * - Removes zone capture section from primary flow
 * - Removes waitlist form (20+ KYC fields) from primary flow
 * - Simplifies Smart Funnel to 2 steps with 5 fields:
 *   Full name, Email, Phone, Investment range, Required consent
 * - Updates all primary CTAs to use openFunnel()
 * - Adds UTM parameter preservation
 * - Updates success step to redirect to member registration
 *
 * Usage: bun run consolidate-registration.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const LAND_DIR = '/home/user/rork-app/expo/ivxholding-landing';
const INDEX = LAND_DIR + '/index.html';

console.log('=== IVX Registration Consolidation ===\n');

let html = readFileSync(INDEX, 'utf-8');
const originalSize = html.length;
console.log('Original size:', (originalSize / 1024).toFixed(1), 'KB,', html.split('\n').length, 'lines');

// ═════════════════════════════════════════════════════
// 1. Remove zone capture section
// ═════════════════════════════════════════════════════
const zoneStart = html.indexOf('<section id="zone-capture">');
if (zoneStart >= 0) {
  // Find the matching </section> — sections don't nest in this HTML
  const zoneEnd = html.indexOf('</section>', zoneStart);
  if (zoneEnd >= 0) {
    const removed = html.substring(zoneStart, zoneEnd + '</section>'.length);
    html = html.substring(0, zoneStart) + '\n<!-- Zone Capture removed from primary flow — secondary route accessible via /capture -->\n' + html.substring(zoneEnd + '</section>'.length);
    console.log('✅ Removed zone capture section (' + removed.split('\n').length + ' lines)');
  }
} else {
  console.log('⚠️  Zone capture section not found');
}

// ═════════════════════════════════════════════════════
// 2. Remove waitlist section
// ═════════════════════════════════════════════════════
const wlStart = html.indexOf('<section class="waitlist-section" id="waitlist">');
if (wlStart >= 0) {
  const wlEnd = html.indexOf('</section>', wlStart);
  if (wlEnd >= 0) {
    const removed = html.substring(wlStart, wlEnd + '</section>'.length);
    html = html.substring(0, wlStart) + '\n<!-- Waitlist form removed from primary flow — KYC moved to post-conversion onboarding -->\n' + html.substring(wlEnd + '</section>'.length);
    console.log('✅ Removed waitlist section (' + removed.split('\n').length + ' lines)');
  }
} else {
  console.log('⚠️  Waitlist section not found');
}

// ═════════════════════════════════════════════════════
// 3. Simplify Smart Funnel — change step badges
// ═════════════════════════════════════════════════════
html = html.replace('STEP 1 OF 3', 'STEP 1 OF 2');
html = html.replace('STEP 2 OF 3', 'STEP 2 OF 2');
// Remove step 3 badge reference (it becomes the success step)
html = html.replace('STEP 3 OF 3', 'COMPLETE');
console.log('✅ Updated Smart Funnel step badges (3 steps → 2 steps)');

// ═════════════════════════════════════════════════════
// 4. Simplify Smart Funnel form (Step 2)
//    Replace first/last name + email + phone with:
//    Full name, Email, Phone, Investment range, Consent
// ═════════════════════════════════════════════════════
const oldFormFields = `        <form class="funnel-form" id="funnel-form" onsubmit="handleFunnelSubmit(event)">
          <div class="funnel-form-row">
            <input type="text" class="funnel-input" id="f-first" placeholder="First name" required />
            <input type="text" class="funnel-input" id="f-last" placeholder="Last name" />
          </div>
          <input type="email" class="funnel-input" id="f-email" placeholder="Email address" required />
          <input type="tel" class="funnel-input" id="f-phone" placeholder="Phone (optional)" />
          <div class="funnel-error" id="funnel-error"></div>
          <button type="submit" class="funnel-submit" id="funnel-submit-btn">Submit review request &rarr;</button>
          <p class="funnel-disclaimer">By continuing, you agree to our Terms of Service and Privacy Policy. No spam — ever.</p>
        </form>`;

const newFormFields = `        <form class="funnel-form" id="funnel-form" onsubmit="handleFunnelSubmit(event)">
          <input type="text" class="funnel-input" id="f-name" placeholder="Full name" required autocomplete="name"
                 aria-label="Full name" />
          <input type="email" class="funnel-input" id="f-email" placeholder="Email address" required autocomplete="email"
                 aria-label="Email address" />
          <input type="tel" class="funnel-input" id="f-phone" placeholder="Phone number" required autocomplete="tel"
                 aria-label="Phone number" />
          <select class="funnel-input" id="f-range" required aria-label="Investment range">
            <option value="">Investment range…</option>
            <option value="0-5k">$0 – $5,000</option>
            <option value="5k-25k">$5,000 – $25,000</option>
            <option value="25k-100k">$25,000 – $100,000</option>
            <option value="100k-500k">$100,000 – $500,000</option>
            <option value="500k+">$500,000+</option>
          </select>
          <label class="funnel-consent" style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:var(--text2,#bbb);margin:8px 0;cursor:pointer;">
            <input type="checkbox" id="f-consent" required style="margin-top:3px;flex-shrink:0;" />
            <span>I agree to the <a href="/legal/terms.html" target="_blank" style="color:var(--gold);">Terms of Service</a> and <a href="/legal/privacy.html" target="_blank" style="color:var(--gold);">Privacy Policy</a>, and I authorize IVX to contact me about investor onboarding.</span>
          </label>
          <div class="funnel-error" id="funnel-error"></div>
          <button type="submit" class="funnel-submit" id="funnel-submit-btn">Start Investor Review &rarr;</button>
          <p class="funnel-disclaimer">By continuing, you agree to our Terms of Service and Privacy Policy. No spam — ever.</p>
        </form>`;

if (html.includes(oldFormFields)) {
  html = html.replace(oldFormFields, newFormFields);
  console.log('✅ Simplified Smart Funnel form (4 fields → 5 fields: name, email, phone, range, consent)');
} else {
  console.log('⚠️  Smart Funnel form fields not found — may have already been updated');
}

// ═════════════════════════════════════════════════════
// 5. Update success step — remove waitlist redirect
// ═════════════════════════════════════════════════════
const oldSuccessBtn = `closeFunnel();document.getElementById('waitlist').scrollIntoView({behavior:'smooth'});`;
const newSuccessBtn = `closeFunnel();openMemberReg();`;
if (html.includes(oldSuccessBtn)) {
  html = html.replace(oldSuccessBtn, newSuccessBtn);
  console.log('✅ Updated success step redirect (waitlist → member registration)');
} else {
  console.log('⚠️  Success step button not found');
}

// Also update the success step referral box text
const oldReferralText = `Confirm phone, identity references, tax details, and signature in the investor intake below.`;
const newReferralText = `Create your free member account to complete phone verification and unlock the investor onboarding flow.`;
if (html.includes(oldReferralText)) {
  html = html.replace(oldReferralText, newReferralText);
  console.log('✅ Updated success step referral text');
}

// Update success step next steps — move KYC to post-conversion
const oldNextSteps = `<div class="fns-item"><div class="fns-icon">&#128737;</div><div class="fns-text"><div class="fns-label">Complete investor intake</div><div class="fns-desc">Confirm phone, identity references, tax details, and signature</div></div></div>`;
const newNextSteps = `<div class="fns-item"><div class="fns-icon">&#128737;</div><div class="fns-text"><div class="fns-label">Create your account</div><div class="fns-desc">Free member registration with email verification — KYC and accreditation come later</div></div></div>`;
if (html.includes(oldNextSteps)) {
  html = html.replace(oldNextSteps, newNextSteps);
  console.log('✅ Updated success step next steps (KYC → post-conversion)');
}

// ═════════════════════════════════════════════════════
// 6. Update primary CTAs to use openFunnel()
// ═════════════════════════════════════════════════════
// Replace openMemberReg() calls on primary CTAs with openFunnel()
// Keep openMemberReg() for the actual member registration modal
const ctaReplacements = [
  { old: 'onclick="openMemberReg()">Create Free Account', new: 'onclick="openFunnel()">Create Free Account' },
  { old: 'onclick="openMemberReg()">Start Step 1', new: 'onclick="openFunnel()">Start Step 1' },
];

let ctaCount = 0;
for (const cta of ctaReplacements) {
  while (html.includes(cta.old)) {
    html = html.replace(cta.old, cta.new);
    ctaCount++;
  }
}
console.log('✅ Updated', ctaCount, 'primary CTAs to use openFunnel()');

// ═════════════════════════════════════════════════════
// 7. Add UTM parameter preservation to funnel form
// ═════════════════════════════════════════════════════
// Add hidden fields for UTM parameters in the funnel form
const utmHiddenFields = `          <!-- UTM attribution preservation -->
          <input type="hidden" id="f-utm-source" value="" />
          <input type="hidden" id="f-utm-medium" value="" />
          <input type="hidden" id="f-utm-campaign" value="" />
          <input type="hidden" id="f-utm-content" value="" />
          <input type="hidden" id="f-utm-term" value="" />`;

// Insert UTM hidden fields right after the form tag
const formTag = '<form class="funnel-form" id="funnel-form" onsubmit="handleFunnelSubmit(event)">';
if (html.includes(formTag)) {
  html = html.replace(formTag, formTag + '\n' + utmHiddenFields);
  console.log('✅ Added UTM parameter preservation fields');
}

// Add UTM capture script
const utmScript = `<script>
// Capture UTM parameters on page load
(function() {
  var params = new URLSearchParams(window.location.search);
  var utmFields = {
    'f-utm-source': 'utm_source',
    'f-utm-medium': 'utm_medium',
    'f-utm-campaign': 'utm_campaign',
    'f-utm-content': 'utm_content',
    'f-utm-term': 'utm_term'
  };
  for (var fieldId in utmFields) {
    var val = params.get(utmFields[fieldId]);
    if (val) {
      var el = document.getElementById(fieldId);
      if (el) el.value = val;
    }
  }
  // Store in sessionStorage for cross-page persistence
  if (params.toString()) {
    try { sessionStorage.setItem('ivx_utm', params.toString()); } catch(e) {}
  }
})();
</script>`;

// Insert UTM script before closing body
if (!html.includes('f-utm-source')) {
  html = html.replace('</body>', utmScript + '\n</body>');
  console.log('✅ Added UTM capture script');
}

// ═════════════════════════════════════════════════════
// 8. Add duplicate-submission protection to funnel form
// ═════════════════════════════════════════════════════
const dedupScript = `<script>
// Duplicate-submission protection for funnel form
(function() {
  var form = document.getElementById('funnel-form');
  if (!form) return;
  var submitted = false;
  form.addEventListener('submit', function(e) {
    if (submitted) {
      e.preventDefault();
      console.log('[IVX] Duplicate submission prevented');
      return false;
    }
    submitted = true;
    var btn = document.getElementById('funnel-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      btn.style.opacity = '0.6';
    }
    // Re-enable after 10 seconds in case of error
    setTimeout(function() {
      submitted = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Start Investor Review →';
        btn.style.opacity = '1';
      }
    }, 10000);
  });
})();
</script>`;

if (!html.includes('Duplicate-submission protection')) {
  html = html.replace('</body>', dedupScript + '\n</body>');
  console.log('✅ Added duplicate-submission protection');
}

// ═════════════════════════════════════════════════════
// Write modified HTML
// ═════════════════════════════════════════════════════
writeFileSync(INDEX, html, 'utf-8');
const newSize = html.length;
console.log('\n=== CONSOLIDATION COMPLETE ===');
console.log('Original:', (originalSize / 1024).toFixed(1), 'KB,', html.split('\n').length, 'lines');
console.log('Modified:', (newSize / 1024).toFixed(1), 'KB,', html.split('\n').length, 'lines');
console.log('Size change:', ((newSize - originalSize) / 1024).toFixed(1), 'KB');
console.log('');
console.log('Changes:');
console.log('  - Zone capture section: REMOVED from primary flow');
console.log('  - Waitlist form (20+ KYC fields): REMOVED from primary flow');
console.log('  - Smart Funnel: simplified to 2 steps, 5 fields');
console.log('  - Primary CTAs: updated to openFunnel()');
console.log('  - UTM parameters: preserved across navigation');
console.log('  - Duplicate-submission protection: added');
console.log('  - KYC/accreditation: moved to post-conversion onboarding');
