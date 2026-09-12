// Validate required credentials and the verification URL before changing any service.
for (const name of ['RAILWAY_TOKEN', 'OPS_READ_TOKEN']) {
  if (!process.env[name]?.trim()) throw new Error(`Missing configuration: ${name}`);
}
const url = new URL(process.env.CRM_BASE_URL);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('CRM_BASE_URL must be a plain HTTPS origin');
}
console.log('Required deployment and verification configuration is present.');
