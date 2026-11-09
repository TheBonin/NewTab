// Copy this file to config.js and fill in a read-only (PVEAuditor) API token.
// config.js is gitignored so the token never reaches the repository.
window.PVE_CONFIG = {
    host: 'https://192.168.15.29:8006',
    node: 'PVE-01',
    tokenId: 'root@pam!newtab',
    tokenSecret: '',
    refreshSeconds: 10
};
