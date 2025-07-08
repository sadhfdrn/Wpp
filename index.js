// index.js - Main server file with modular structure
const express = require('express');
const path = require('path');
const SessionManager = require('./sessionSend');
const QRCodeHandler = require('./qr');
const PairingCodeHandler = require('./pair');

const app = express();
const PORT = process.env.PORT || 3000;

// Store active sessions and tokens
const sessions = new Map();
const sessionTokens = new Map();

// Initialize handlers
const qrHandler = new QRCodeHandler(sessions);
const pairingHandler = new PairingCodeHandler(sessions);
const sessionManager = new SessionManager(sessions, sessionTokens, qrHandler, pairingHandler);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize connection
app.post('/api/connect', async (req, res) => {
    try {
        const { phoneNumber, method = 'pairing-code' } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Format phone number
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        
        // Basic validation for country code
        if (formattedPhone.length < 10) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }
        
        // Generate session ID
        const sessionId = sessionManager.generateSessionId();
        
        // Validate method
        const useQR = method === 'qr-code';
        
        // Store initial session info
        sessions.set(sessionId, {
            phoneNumber: formattedPhone,
            status: 'initializing',
            connectionMethod: method,
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

        // Initialize WhatsApp connection in background
        setImmediate(async () => {
            try {
                await sessionManager.initializeWhatsApp(formattedPhone, sessionId, useQR);
            } catch (error) {
                console.error('Background initialization error:', error);
                const session = sessions.get(sessionId);
                if (session) {
                    session.status = 'error';
                    session.error = error.message;
                    sessions.set(sessionId, session);
                }
            }
        });

        res.json({
            success: true,
            sessionId,
            method,
            message: `Connection process started using ${method}. Please wait...`
        });
    } catch (error) {
        console.error('Connect error:', error);
        res.status(500).json({ error: 'Failed to initialize connection' });
    }
});

// Check connection status
app.get('/api/status/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = sessions.get(sessionId);
        
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Check if client is still connected
        const isConnected = await sessionManager.isSessionConnected(sessionId);
        if (!isConnected && session.status === 'CONNECTED') {
            session.status = 'disconnected';
            sessions.set(sessionId, session);
        }

        // Get QR and pairing code status
        const qrStatus = qrHandler.getQRCodeStatus(sessionId);
        const pairingStatus = pairingHandler.getPairingCodeStatus(sessionId);

        res.json({
            sessionId,
            phoneNumber: session.phoneNumber,
            status: session.status,
            connectionMethod: session.connectionMethod,
            ...qrStatus,
            ...pairingStatus,
            loadingPercent: session.loadingPercent,
            loadingMessage: session.loadingMessage,
            isConnected,
            timestamp: session.timestamp,
            error: session.error || null
        });
    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to check status' });
    }
});

// Generate new QR code
app.post('/api/generate-qr/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await qrHandler.generateNewQRCode(sessionId);
        res.json(result);
    } catch (error) {
        console.error('QR generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Generate new pairing code
app.post('/api/generate-pairing-code/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await pairingHandler.generateNewPairingCode(sessionId);
        res.json(result);
    } catch (error) {
        console.error('Pairing code generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Restart session
app.post('/api/restart/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await sessionManager.restartSession(sessionId);
        res.json(result);
    } catch (error) {
        console.error('Restart error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get session credentials
app.get('/api/credentials/:sessionId', (req, res) => {
    try {
        const { sessionId } = req.params;
        const credentials = sessionManager.getSessionCredentials(sessionId);
        
        if (!credentials) {
            return res.status(404).json({ error: 'Credentials not found' });
        }

        res.json(credentials);
    } catch (error) {
        console.error('Credentials error:', error);
        res.status(500).json({ error: 'Failed to read credentials' });
    }
});

// Disconnect session
app.post('/api/disconnect/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const result = await sessionManager.disconnectSession(sessionId);
        res.json(result);
    } catch (error) {
        console.error('Disconnect error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send test message
app.post('/api/send-message/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { to, message } = req.body;
        
        const result = await sessionManager.sendMessage(sessionId, to, message);
        res.json(result);
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        activeSessions: sessions.size,
        chromeExecutablePath: process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        environment: process.env.NODE_ENV || 'development'
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Using Chrome executable: ${process.env.CHROME_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable'}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Clean up old sessions every hour
setInterval(() => {
    sessionManager.cleanupOldSessions();
}, 60 * 60 * 1000); // Run every hour

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    
    // Close all sessions
    for (const [sessionId, session] of sessions.entries()) {
        try {
            if (session.client) {
                await session.client.close();
            }
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
    }
    
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

module.exports = app;