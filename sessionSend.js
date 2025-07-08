// sessionSend.js - Session management and message sending module
const { create } = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class SessionManager {
    constructor(sessions, sessionTokens, qrHandler, pairingHandler) {
        this.sessions = sessions;
        this.sessionTokens = sessionTokens;
        this.qrHandler = qrHandler;
        this.pairingHandler = pairingHandler;
        this.CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable';
    }

    // Generate unique session ID
    generateSessionId() {
        return crypto.randomBytes(16).toString('hex');
    }

    // Generate device fingerprint for reconnection
    generateDeviceFingerprint() {
        const deviceId = crypto.randomBytes(32).toString('hex');
        const clientToken = crypto.randomBytes(16).toString('hex');
        const serverToken = crypto.randomBytes(16).toString('hex');
        return {
            deviceId,
            clientToken,
            serverToken,
            timestamp: new Date().toISOString()
        };
    }

    // Store session tokens for persistence
    storeSessionToken(sessionId, phoneNumber, token) {
        const tokenData = {
            sessionId,
            phoneNumber,
            token,
            timestamp: new Date().toISOString()
        };
        
        const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
        
        // Ensure tokens directory exists
        if (!fs.existsSync(path.join(__dirname, 'tokens'))) {
            fs.mkdirSync(path.join(__dirname, 'tokens'), { recursive: true });
        }
        
        fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
        this.sessionTokens.set(sessionId, tokenData);
        return tokenData;
    }

    // Load existing session token
    loadSessionToken(sessionId) {
        const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
        
        if (fs.existsSync(tokenPath)) {
            try {
                const tokenData = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                this.sessionTokens.set(sessionId, tokenData);
                return tokenData;
            } catch (error) {
                console.error('Error loading session token:', error);
            }
        }
        return null;
    }

    // Store comprehensive reconnection credentials
    async storeReconnectionCredentials(sessionId, phoneNumber, client) {
        try {
            // Generate device fingerprint
            const deviceFingerprint = this.generateDeviceFingerprint();
            
            // Get WhatsApp specific data
            const wppData = {
                sessionId,
                phoneNumber,
                deviceFingerprint,
                connectionTime: new Date().toISOString(),
                serverEnvironment: process.env.NODE_ENV || 'production',
                serverVersion: process.env.npm_package_version || '1.0.0'
            };

            // Try to get session token from browser
            let sessionToken = null;
            try {
                sessionToken = await client.getSessionTokenBrowser();
            } catch (error) {
                console.warn('Could not retrieve session token:', error.message);
            }

            // Try to get WABrowserId
            let waBrowserId = null;
            try {
                waBrowserId = await client.getWABrowserId();
            } catch (error) {
                console.warn('Could not retrieve WABrowserId:', error.message);
            }

            // Try to get device info
            let deviceInfo = null;
            try {
                deviceInfo = await client.getDeviceInfo();
            } catch (error) {
                console.warn('Could not retrieve device info:', error.message);
            }

            // Create comprehensive credentials
            const reconnectionCreds = {
                // Basic session info
                sessionId,
                phoneNumber,
                deviceFingerprint,
                
                // Connection details
                connectionTime: new Date().toISOString(),
                serverEnvironment: process.env.NODE_ENV || 'production',
                serverVersion: process.env.npm_package_version || '1.0.0',
                
                // WhatsApp specific tokens
                sessionToken,
                waBrowserId,
                deviceInfo,
                
                // Security tokens
                authToken: crypto.randomBytes(32).toString('hex'),
                encryptionKey: crypto.randomBytes(32).toString('hex'),
                
                // Expiration (valid for 30 days)
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                
                // Usage tracking
                lastUsed: new Date().toISOString(),
                usageCount: 0,
                
                // Reconnection instructions
                instructions: {
                    endpoint: process.env.SERVER_ENDPOINT || 'https://your-server.com',
                    reconnectPath: '/api/reconnect',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${crypto.randomBytes(32).toString('hex')}`
                    }
                }
            };

            // Store in credentials directory
            const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
            
            // Ensure credentials directory exists
            if (!fs.existsSync(path.join(__dirname, 'credentials'))) {
                fs.mkdirSync(path.join(__dirname, 'credentials'), { recursive: true });
            }
            
            fs.writeFileSync(credPath, JSON.stringify(reconnectionCreds, null, 2));
            
            // Also store in a backup location with phone number
            const backupPath = path.join(__dirname, 'credentials', 'backup', `${phoneNumber.replace(/[^0-9]/g, '')}.json`);
            if (!fs.existsSync(path.join(__dirname, 'credentials', 'backup'))) {
                fs.mkdirSync(path.join(__dirname, 'credentials', 'backup'), { recursive: true });
            }
            fs.writeFileSync(backupPath, JSON.stringify(reconnectionCreds, null, 2));
            
            return reconnectionCreds;
        } catch (error) {
            console.error('Error storing reconnection credentials:', error);
            throw error;
        }
    }

    // Load reconnection credentials
    loadReconnectionCredentials(sessionId) {
        const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
        
        if (!fs.existsSync(credPath)) {
            return null;
        }

        try {
            const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
            
            // Check if credentials are expired
            if (new Date() > new Date(credentials.expiresAt)) {
                console.log('Credentials expired, removing...');
                fs.unlinkSync(credPath);
                return null;
            }
            
            return credentials;
        } catch (error) {
            console.error('Error loading reconnection credentials:', error);
            return null;
        }
    }

    // Send comprehensive credentials to user's WhatsApp
    async sendCredentialsToUser(client, phoneNumber, sessionId) {
        try {
            console.log('Generating and sending reconnection credentials...');
            
            // Store comprehensive credentials
            const reconnectionCreds = await this.storeReconnectionCredentials(sessionId, phoneNumber, client);
            
            // Create user-friendly credential summary
            const credentialSummary = {
                sessionId: reconnectionCreds.sessionId,
                phoneNumber: reconnectionCreds.phoneNumber,
                deviceId: reconnectionCreds.deviceFingerprint.deviceId,
                authToken: reconnectionCreds.authToken,
                expiresAt: reconnectionCreds.expiresAt,
                reconnectEndpoint: reconnectionCreds.instructions.endpoint + reconnectionCreds.instructions.reconnectPath
            };

            // Format message for user
            const message = `🔐 *WhatsApp Connection Successful*\n\n` +
                           `✅ Your device is now connected!\n\n` +
                           `📱 *Connection Details:*\n` +
                           `• Session ID: \`${reconnectionCreds.sessionId}\`\n` +
                           `• Phone: ${reconnectionCreds.phoneNumber}\n` +
                           `• Connected: ${new Date(reconnectionCreds.connectionTime).toLocaleString()}\n` +
                           `• Server: ${reconnectionCreds.serverEnvironment}\n\n` +
                           `🔑 *Reconnection Credentials:*\n` +
                           `• Device ID: \`${reconnectionCreds.deviceFingerprint.deviceId}\`\n` +
                           `• Auth Token: \`${reconnectionCreds.authToken}\`\n` +
                           `• Valid Until: ${new Date(reconnectionCreds.expiresAt).toLocaleString()}\n\n` +
                           `🌐 *Reconnection Info:*\n` +
                           `• Endpoint: ${reconnectionCreds.instructions.endpoint}\n` +
                           `• Path: ${reconnectionCreds.instructions.reconnectPath}\n\n` +
                           `📋 *How to Reconnect:*\n` +
                           `1. Send POST request to reconnection endpoint\n` +
                           `2. Include your Session ID and Auth Token\n` +
                           `3. Your device will be automatically recognized\n\n` +
                           `💾 *Credential Package:*\n` +
                           `\`\`\`json\n${JSON.stringify(credentialSummary, null, 2)}\`\`\`\n\n` +
                           `⚠️ *Important:*\n` +
                           `• Keep these credentials secure\n` +
                           `• Don't share with others\n` +
                           `• Save in a secure location\n` +
                           `• Credentials expire in 30 days\n\n` +
                           `🔄 *Need help reconnecting?*\n` +
                           `Contact support with your Session ID.`;

            // Send message to user
            const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
            await client.sendText(chatId, message);
            
            // Also send as a document for easy saving
            const credentialsFile = {
                filename: `whatsapp_credentials_${sessionId}.json`,
                content: JSON.stringify(reconnectionCreds, null, 2)
            };
            
            // Send credentials as file
            try {
                const tempFilePath = path.join(__dirname, 'temp', credentialsFile.filename);
                
                // Ensure temp directory exists
                if (!fs.existsSync(path.join(__dirname, 'temp'))) {
                    fs.mkdirSync(path.join(__dirname, 'temp'), { recursive: true });
                }
                
                fs.writeFileSync(tempFilePath, credentialsFile.content);
                
                await client.sendFile(chatId, tempFilePath, credentialsFile.filename, 
                    '📄 Your complete reconnection credentials file. Keep this secure!');
                
                // Clean up temp file
                fs.unlinkSync(tempFilePath);
            } catch (fileError) {
                console.warn('Could not send credentials file:', fileError.message);
            }
            
            console.log('Comprehensive credentials sent to user:', phoneNumber);
            return reconnectionCreds;
        } catch (error) {
            console.error('Error sending credentials:', error);
            throw error;
        }
    }

    // Reconnect using stored credentials
    async reconnectWithCredentials(sessionId, authToken, deviceId) {
        try {
            console.log('Attempting to reconnect with credentials...');
            
            // Load credentials
            const credentials = this.loadReconnectionCredentials(sessionId);
            
            if (!credentials) {
                throw new Error('No valid credentials found for this session');
            }

            // Verify provided credentials
            if (credentials.authToken !== authToken || 
                credentials.deviceFingerprint.deviceId !== deviceId) {
                throw new Error('Invalid credentials provided');
            }

            // Check if session already exists and is connected
            const existingSession = this.sessions.get(sessionId);
            if (existingSession && existingSession.status === 'CONNECTED') {
                const isConnected = await this.isSessionConnected(sessionId);
                if (isConnected) {
                    console.log('Session already connected');
                    return { success: true, message: 'Session already connected' };
                }
            }

            // Update usage tracking
            credentials.lastUsed = new Date().toISOString();
            credentials.usageCount += 1;
            
            // Save updated credentials
            const credPath = path.join(__dirname, 'credentials', `${sessionId}.json`);
            fs.writeFileSync(credPath, JSON.stringify(credentials, null, 2));

            // Initialize WhatsApp with stored credentials
            await this.initializeWhatsApp(credentials.phoneNumber, sessionId, false);
            
            return { 
                success: true, 
                message: 'Reconnection initiated successfully',
                sessionId,
                phoneNumber: credentials.phoneNumber
            };
        } catch (error) {
            console.error('Error reconnecting with credentials:', error);
            throw error;
        }
    }

    // Initialize WhatsApp connection
    async initializeWhatsApp(phoneNumber, sessionId, useQR = false) {
        try {
            console.log(`Initializing WhatsApp for phone: ${phoneNumber}, session: ${sessionId}, useQR: ${useQR}`);
            console.log(`Using Chrome executable: ${this.CHROME_EXECUTABLE_PATH}`);
            
            // Load existing token if available
            const existingToken = this.loadSessionToken(sessionId);
            
            const client = await create({
                session: sessionId,
                multiDevice: true,
                folderNameToken: path.join(__dirname, 'tokens'),
                mkdirFolderToken: path.join(__dirname, 'tokens'),
                headless: true,
                devtools: false,
                useChrome: true,
                debug: false,
                logQR: true,
                disableSpins: true,
                disableWelcome: true,
                autoClose: 0,
                createPathFileToken: true,
                waitForLogin: true,
                executablePath: this.CHROME_EXECUTABLE_PATH,
                linkingMethod: useQR ? 'qr-code' : 'pairing-code',
                
                browserArgs: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--window-size=1366,768',
                    '--no-first-run',
                    '--disable-extensions',
                    '--disable-plugins',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-field-trial-config',
                    '--disable-back-forward-cache',
                    '--disable-ipc-flooding-protection',
                    '--disable-background-networking',
                    '--disable-breakpad',
                    '--disable-client-side-phishing-detection',
                    '--disable-component-update',
                    '--disable-default-apps',
                    '--disable-domain-reliability',
                    '--disable-features=AudioServiceOutOfProcess',
                    '--disable-hang-monitor',
                    '--disable-print-preview',
                    '--disable-prompt-on-repost',
                    '--disable-sync',
                    '--disable-translate',
                    '--metrics-recording-only',
                    '--no-default-browser-check',
                    '--no-pings',
                    '--password-store=basic',
                    '--use-mock-keychain',
                    '--single-process',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Samuel/117.0.0.0 Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.31'
                ],
                
                puppeteerOptions: {
                    headless: true,
                    executablePath: this.CHROME_EXECUTABLE_PATH,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--disable-features=VizDisplayCompositor',
                        '--single-process'
                    ],
                    defaultViewport: {
                        width: 1366,
                        height: 768
                    },
                    timeout: 60000
                },
                
                // Use handlers from respective modules
                catchQR: this.qrHandler.handleQRCode(sessionId),
                catchPairingCode: this.pairingHandler.handlePairingCode(sessionId),
                
                // Status handler
                statusFind: (statusSession, session) => {
                    console.log('Status Session:', statusSession);
                    console.log('Session name:', session);
                    
                    const sessionData = this.sessions.get(sessionId);
                    if (sessionData) {
                        sessionData.status = statusSession;
                        this.sessions.set(sessionId, sessionData);
                    }
                },
                
                // Loading handler
                onLoadingScreen: (percent, message) => {
                    console.log(`Loading: ${percent}% - ${message}`);
                    const session = this.sessions.get(sessionId);
                    if (session) {
                        session.loadingPercent = percent;
                        session.loadingMessage = message;
                        this.sessions.set(sessionId, session);
                    }
                }
            });

            // Store session
            this.sessions.set(sessionId, {
                client,
                phoneNumber,
                status: 'connecting',
                connectionMethod: useQR ? 'qr-code' : 'pairing-code',
                qrCode: null,
                qrAttempts: 0,
                qrUrl: null,
                qrCodeExpiry: null,
                pairingCode: null,
                pairingCodeExpiry: null,
                loadingPercent: 0,
                loadingMessage: '',
                timestamp: new Date()
            });

            // Handle state changes
            client.onStateChange((state) => {
                console.log('State changed:', state);
                const session = this.sessions.get(sessionId);
                if (session) {
                    session.status = state;
                    this.sessions.set(sessionId, session);
                    
                    // Handle successful connection
                    if (state === 'CONNECTED') {
                        console.log('Successfully connected to WhatsApp');
                        this.sendCredentialsToUser(client, phoneNumber, sessionId);
                        
                        // Store session token for persistence
                        client.getSessionTokenBrowser().then(token => {
                            if (token) {
                                this.storeSessionToken(sessionId, phoneNumber, token);
                            }
                        }).catch(console.error);
                    }
                }
            });

            // Enhanced message handler
            client.onMessage(async (message) => {
                console.log('Message received:', message.from, message.body);
            });

            // Handle other events
            client.onInChat((chatId) => {
                console.log('In chat:', chatId);
            });

            client.onAck((ack) => {
                console.log('Message ACK:', ack);
            });

            // Start the client
            await client.start();
            
            console.log('Client started successfully');
            
            return client;
        } catch (error) {
            console.error('Error initializing WhatsApp:', error);
            
            // Update session with error
            const session = this.sessions.get(sessionId);
            if (session) {
                session.status = 'error';
                session.error = error.message;
                this.sessions.set(sessionId, session);
            }
            
            throw error;
        }
    }

    // Send message through WhatsApp
    async sendMessage(sessionId, to, message) {
        const session = this.sessions.get(sessionId);
        
        if (!session || !session.client) {
            throw new Error('Session not found or not connected');
        }

        // Check if client is connected
        const isConnected = await session.client.isConnected();
        if (!isConnected) {
            throw new Error('Session is not connected');
        }

        const chatId = to.includes('@') ? to : `${to}@c.us`;
        await session.client.sendText(chatId, message);
        
        return { success: true, message: 'Message sent successfully' };
    }

    // Check if session is connected
    async isSessionConnected(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (!session || !session.client || session.status !== 'CONNECTED') {
            return false;
        }

        try {
            return await session.client.isConnected();
        } catch (error) {
            console.error('Error checking connection status:', error);
            return false;
        }
    }

    // Restart session
    async restartSession(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            throw new Error('Session not found');
        }

        // Close existing client
        if (session.client) {
            await session.client.close();
        }

        // Reset session status
        session.status = 'initializing';
        session.qrCode = null;
        session.qrAttempts = 0;
        session.qrCodeExpiry = null;
        session.pairingCode = null;
        session.pairingCodeExpiry = null;
        session.error = null;
        session.client = null;
        this.sessions.set(sessionId, session);

        // Restart connection
        const useQR = session.connectionMethod === 'qr-code';
        await this.initializeWhatsApp(session.phoneNumber, sessionId, useQR);
        
        return { success: true, message: 'Session restart initiated' };
    }

    // Disconnect session
    async disconnectSession(sessionId) {
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.client) {
            await session.client.close();
        }
        this.sessions.delete(sessionId);
        
        // Clean up token file
        const tokenPath = path.join(__dirname, 'tokens', `${sessionId}.json`);
        if (fs.existsSync(tokenPath)) {
            fs.unlinkSync(tokenPath);
        }
        
        return { success: true, message: 'Session disconnected' };
    }

    // Get session credentials (legacy method)
    getSessionCredentials(sessionId) {
        return this.loadReconnectionCredentials(sessionId);
    }

    // Clean up old sessions and credentials
    cleanupOldSessions() {
        const now = new Date();
        
        // Clean up active sessions
        for (const [sessionId, session] of this.sessions.entries()) {
            const age = now - session.timestamp;
            // Remove sessions older than 4 hours
            if (age > 4 * 60 * 60 * 1000) {
                console.log(`Cleaning up old session: ${sessionId}`);
                if (session.client) {
                    session.client.close().catch(console.error);
                }
                this.sessions.delete(sessionId);
            }
        }
        
        // Clean up expired credential files
        const credentialsDir = path.join(__dirname, 'credentials');
        if (fs.existsSync(credentialsDir)) {
            const files = fs.readdirSync(credentialsDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const filePath = path.join(credentialsDir, file);
                    try {
                        const credentials = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (new Date() > new Date(credentials.expiresAt)) {
                            console.log(`Removing expired credentials: ${file}`);
                            fs.unlinkSync(filePath);
                        }
                    } catch (error) {
                        console.error(`Error processing credentials file ${file}:`, error);
                    }
                }
            });
        }
        
        // Clean up token files for deleted sessions
        const tokensDir = path.join(__dirname, 'tokens');
        if (fs.existsSync(tokensDir)) {
            const files = fs.readdirSync(tokensDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    const sessionId = file.replace('.json', '');
                    if (!this.sessions.has(sessionId)) {
                        const filePath = path.join(tokensDir, file);
                        console.log(`Removing orphaned token file: ${file}`);
                        fs.unlinkSync(filePath);
                    }
                }
            });
        }
    }
}

module.exports = SessionManager;