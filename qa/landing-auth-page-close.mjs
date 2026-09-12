// Forwarded Auth responses must settle before their page or request client is
// disposed. The context's hosted-request guard stays installed while draining.
export async function closeForwardedAuthPage(page) {
  try { await page.unrouteAll({ behavior: 'wait' }); }
  finally { await page.close(); }
}
