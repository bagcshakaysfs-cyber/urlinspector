const dns = require('node:dns/promises');

/**
 * Resolves public DNS records (A, AAAA, CNAME, MX, TXT) for a given hostname.
 */
async function getDnsInfo(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return { success: false, error: 'Valid hostname is required' };
  }

  const cleanHost = hostname.toLowerCase().trim();
  const records = {
    a: [],
    aaaa: [],
    cname: [],
    mx: [],
    txt: []
  };

  const errors = [];

  // Query A records
  try {
    const a = await dns.resolve4(cleanHost);
    records.a = a || [];
  } catch (err) {
    if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      errors.push(`A: ${err.message}`);
    }
  }

  // Query AAAA records
  try {
    const aaaa = await dns.resolve6(cleanHost);
    records.aaaa = aaaa || [];
  } catch (err) {
    if (err.code !== 'ENODATA' && err.code !== 'ENOTFOUND') {
      errors.push(`AAAA: ${err.message}`);
    }
  }

  // Query CNAME records
  try {
    const cname = await dns.resolveCname(cleanHost);
    records.cname = cname || [];
  } catch {
    // Normal for apex domains to have no CNAME
  }

  // Query MX records
  try {
    const mx = await dns.resolveMx(cleanHost);
    records.mx = (mx || []).sort((a, b) => a.priority - b.priority);
  } catch {
    // Normal if no mail server configured
  }

  // Query TXT records
  try {
    const txt = await dns.resolveTxt(cleanHost);
    // Flatten array of arrays
    records.txt = (txt || []).map(chunks => chunks.join(''));
  } catch {
    // Normal if no TXT records
  }

  const hasAnyRecord =
    records.a.length > 0 ||
    records.aaaa.length > 0 ||
    records.cname.length > 0 ||
    records.mx.length > 0 ||
    records.txt.length > 0;

  return {
    success: hasAnyRecord,
    hostname: cleanHost,
    records,
    error: hasAnyRecord ? null : (errors.length > 0 ? errors.join('; ') : 'No DNS records found.')
  };
}

module.exports = {
  getDnsInfo
};
