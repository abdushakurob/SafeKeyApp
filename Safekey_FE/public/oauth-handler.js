const statusText = document.getElementById('status-text');
const errorDiv = document.getElementById('error-message');
const successDiv = document.getElementById('success-message');
const consoleLog = document.getElementById('console-log');
const retryBtn = document.getElementById('retry-btn');
const closeBtn = document.getElementById('close-btn');

// Enhanced logging
function log(message) {
    console.log(`[OAuth Handler] ${message}`);
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleLog.appendChild(entry);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

function showError(message) {
    log(`ERROR: ${message}`);
    statusText.textContent = 'Error during OAuth';
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    retryBtn.style.display = 'inline-block';
}

function showSuccess(message) {
    log(`SUCCESS: ${message}`);
    statusText.textContent = 'OAuth Complete!';
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    closeBtn.style.display = 'inline-block';
}

// Check if we're handling a callback
function checkCallback() {
    // Check both query params and URL fragment
    const queryParams = new URLSearchParams(window.location.search);
    const fragmentParams = new URLSearchParams(window.location.hash.substring(1));
    
    const code = queryParams.get('code') || fragmentParams.get('code');
    const state = queryParams.get('state') || fragmentParams.get('state');
    const id_token = queryParams.get('id_token') || fragmentParams.get('id_token');
    const access_token = queryParams.get('access_token') || fragmentParams.get('access_token');
    const error = queryParams.get('error') || fragmentParams.get('error');
    const error_description = queryParams.get('error_description') || fragmentParams.get('error_description');

    log(`URL params: code=${code ? 'present' : 'none'}, state=${state ? 'present' : 'none'}, id_token=${id_token ? 'present' : 'none'}, access_token=${access_token ? 'present' : 'none'}, error=${error}`);

    if (error) {
        showError(`OAuth Error: ${error}${error_description ? ' - ' + error_description : ''}`);
        return;
    }

    if (code) {
        log(`Got authorization code: ${code.substring(0, 20)}...`);
        // Store code in chrome.storage.session so popup can access it
        chrome.storage.session.set({ oauth_code: code, oauth_state: state || '' }, () => {
            log('Stored code in chrome.storage.session');
            showSuccess('Authorization code received! You can close this window.');
            setTimeout(() => {
                window.close();
            }, 2000);
        });
        return;
    }

    if (id_token) {
        log(`Got ID token: ${id_token.substring(0, 20)}...`);
        // Store token - use session storage if available (Chrome), otherwise local (Firefox)
        const storage = chrome.storage.session || chrome.storage.local;
        const storageName = chrome.storage.session ? 'chrome.storage.session' : 'chrome.storage.local';
        storage.set({ oauth_id_token: id_token, oauth_access_token: access_token || '' }, () => {
            log(`Stored ID token and access token in ${storageName}`);
            
            // Also notify background script immediately
            chrome.runtime.sendMessage({
                type: 'OAUTH_CALLBACK',
                id_token,
                access_token,
            }, (response) => {
                if (response && response.success) {
                    log('Background script confirmed receipt of tokens');
                }
            });
            
            showSuccess('ID token received! You can close this window.');
            setTimeout(() => {
                window.close();
            }, 2000);
        });
        return;
    }

    // No callback parameters, need to start OAuth flow
    startOAuthFlow();
}

// Start the OAuth flow
async function startOAuthFlow() {
    try {
        log('Starting OAuth flow...');
        
        // Get OAuth client ID and nonce from URL parameters
        const params = new URLSearchParams(window.location.search);
        const clientId = params.get('clientId');
        const nonce = params.get('nonce');
        
        if (!clientId) {
            showError('OAuth client ID not found in URL. Please try again from the popup.');
            return;
        }
        
        if (!nonce) {
            showError('Nonce not found in URL. This is required for zkLogin. Please try again from the popup.');
            return;
        }
        
        log(`Using client ID: ${clientId.substring(0, 20)}...`);
        log(`Using nonce from Enoki: ${nonce.substring(0, 20)}...`);

        // Use localhost as redirect URI (Google OAuth requires http/https)
        const redirectUri = 'http://localhost:3000/callback';
        log(`Redirect URI: ${redirectUri}`);

        // Construct Google OAuth URL (implicit flow with fragment)
        // IMPORTANT: Use the nonce from Enoki, not a random one!
        const oauthParams = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'id_token token',
            scope: 'openid profile email',
            nonce: nonce, // Use Enoki's nonce, not a random one
        });

        const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${oauthParams.toString()}`;
        log(`Redirecting to Google Auth with Enoki nonce...`);

        statusText.textContent = 'Redirecting to Google...';
        window.location.href = googleAuthUrl;

    } catch (error) {
        showError(`Failed to start OAuth flow: ${error.message}`);
    }
}

retryBtn.addEventListener('click', () => {
    location.reload();
});

closeBtn.addEventListener('click', () => {
    window.close();
});

// Check if this is a callback or start flow
log('Page loaded, checking for OAuth callback...');
checkCallback();
