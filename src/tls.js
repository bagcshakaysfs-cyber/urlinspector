const tls = require('node:tls');

/**
 * Inspects the public TLS certificate and cipher parameters of a target host.
 */
function getTlsInfo(hostname, port = 443, timeoutMs = 5000) {
  return new Promise(resolve => {
    const cleanHost = hostname.toLowerCase().trim();

    let resolved = false;
    const socket = tls.connect(
      {
        host: cleanHost,
        port,
        servername: cleanHost,
        rejectUnauthorized: false // We want to inspect the certificate even if self-signed/expired to report its state
      },
      () => {
        if (resolved) return;
        resolved = true;

        try {
          const cert = socket.getPeerCertificate(true);
          const cipher = socket.getCipher();
          const protocol = socket.getProtocol();
          const authorized = socket.authorized;
          const authorizationError = socket.authorizationError;

          socket.end();

          if (!cert || Object.keys(cert).length === 0) {
            return resolve({
              available: false,
              error: 'No peer certificate returned by server.'
            });
          }

          const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
          const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
          const now = new Date();

          let daysRemaining = null;
          let isExpired = false;
          if (validTo) {
            const diffMs = validTo.getTime() - now.getTime();
            daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            isExpired = diffMs < 0;
          }

          // Parse SANs
          let sans = [];
          if (cert.subjectaltname) {
            sans = cert.subjectaltname
              .split(',')
              .map(s => s.trim().replace(/^DNS:/i, ''))
              .filter(Boolean);
          }

          resolve({
            available: true,
            protocol,
            cipher: cipher ? `${cipher.name} (${cipher.version})` : 'Unknown',
            authorized,
            authorizationError: authorizationError || null,
            status: authorized ? 'Valid' : (isExpired ? 'Expired' : 'Untrusted / Invalid'),
            subject: cert.subject ? (cert.subject.CN || cert.subject.O || 'Unknown') : 'Unknown',
            issuer: cert.issuer ? (cert.issuer.O || cert.issuer.CN || 'Unknown') : 'Unknown',
            validFrom: validFrom ? validFrom.toISOString() : null,
            validTo: validTo ? validTo.toISOString() : null,
            daysRemaining,
            isExpired,
            sans: sans.slice(0, 20),
            totalSans: sans.length,
            serialNumber: cert.serialNumber || null,
            fingerprint256: cert.fingerprint256 || null
          });
        } catch (err) {
          resolve({
            available: false,
            error: `Failed to extract TLS certificate details: ${err.message}`
          });
        }
      }
    );

    socket.setTimeout(timeoutMs, () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({
          available: false,
          error: `TLS handshake timed out after ${timeoutMs}ms.`
        });
      }
    });

    socket.on('error', err => {
      if (!resolved) {
        resolved = true;
        resolve({
          available: false,
          error: `TLS connection failed: ${err.message}`
        });
      }
    });
  });
}

module.exports = {
  getTlsInfo
};
