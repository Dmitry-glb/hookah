// Public configuration only. Never put the Siri bearer token here.
(function (root) {
    const config = {
        cloudApiBaseUrl: 'https://dimhookah-preheat.swenplay23.workers.dev',
        defaultDurationSeconds: 7 * 60,
        apiBaseUrl: '' // Set to https://dimhookah-preheat.<your-subdomain>.workers.dev
    };
    if (typeof module === 'object' && module.exports) module.exports = config;
    else root.DimHookahPreheatConfig = config;
})(typeof globalThis === 'object' ? globalThis : this);
