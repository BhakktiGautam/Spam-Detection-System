/**
 * Cache Stampede (Thundering Herd) Prevention Middleware
 * Uses in-memory Promise deduplication.
 */
const pendingRequests = new Map();

const preventCacheStampede = (req, res, next) => {
    // We only want to deduplicate POST requests with a text body (like /predict)
    if (req.method !== 'POST' || !req.body.text) {
        return next();
    }

    // Generate a simple cache key based on the input text
    const text = req.body.text.trim();
    const cacheKey = Buffer.from(text).toString('base64').substring(0, 64);

    // If another request is currently fetching this exact same data, WAIT for its promise
    if (pendingRequests.has(cacheKey)) {
        console.log(`🛡️ [Cache Lock] Thundering herd prevented! Waiting for active request...`);
        
        pendingRequests.get(cacheKey)
            .then(cachedResponse => {
                return res.json(cachedResponse);
            })
            .catch(err => {
                return res.status(500).json({ error: "Upstream API failed during concurrent request" });
            });
        return; 
    }

    // If this is the FIRST request, create a new Promise
    let resolvePromise, rejectPromise;
    const requestPromise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    // Store it in the map
    pendingRequests.set(cacheKey, requestPromise);

    // Hijack Express's res.json() to capture the data
    const originalJson = res.json.bind(res);
    
    res.json = (body) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            resolvePromise(body);
        } else {
            rejectPromise(new Error("Request failed"));
        }
        
        pendingRequests.delete(cacheKey);
        return originalJson(body);
    };

    // Safety timeout (15 seconds)
    setTimeout(() => {
        if (pendingRequests.has(cacheKey)) {
            pendingRequests.delete(cacheKey);
            rejectPromise(new Error("Cache lock timeout"));
        }
    }, 15000);

    next();
};

module.exports = { preventCacheStampede };