// pair.js - Fixed Pairing Code handling module
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

class PairingCodeHandler {
    constructor(sessions) {
        this.sessions = sessions;
    }

    // Handle pairing code generation during initialization
    handlePairingCode(sessionId) {
        return (pairingCode) => {
            console.log('Pairing code generated for session:', sessionId, 'Code:', pairingCode);
            
            const session = this.sessions.get(sessionId);
            if (session) {
                session.pairingCode = pairingCode;
                session.status = 'pairing_code_ready';
                session.pairingCodeExpiry = new Date(Date.now() + 300000); // 5 minutes expiry
                this.sessions.set(sessionId, session);
                
                console.log('Pairing code stored for session:', sessionId);
                
                // Emit event if session has event emitter
                if (session.eventEmitter) {
                    session.eventEmitter.emit('pairing_code_ready', {
                        sessionId,
                        pairingCode,
                        expiry: session.pairingCodeExpiry
                    });
                }
            }
        };
    }

    // Generate new pairing code for existing session
    async generateNewPairingCode(sessionId, phoneNumber) {
        const session = this.sessions.get(sessionId);
        
        if (!session) {
            throw new Error('Session not found');
        }

        if (session.connectionMethod !== 'pairing-code') {
            throw new Error('Session is not using pairing code method');
        }

        // Check if client exists and is properly initialized
        if (!session.client) {
            throw new Error('Client not initialized');
        }

        // Wait for client to be ready
        if (session.client.isReady === false) {
            await this.waitForClientReady(session.client, 30000); // 30 second timeout
        }

        let pairingCode;
        try {
            // WPPConnect uses genLinkDeviceCodeForPhoneNumber for pairing codes
            if (typeof session.client.genLinkDeviceCodeForPhoneNumber === 'function') {
                pairingCode = await session.client.genLinkDeviceCodeForPhoneNumber(phoneNumber);
            } else if (session.client.page) {
                // Direct page evaluation using WPP.conn.genLinkDeviceCodeForPhoneNumber
                pairingCode = await session.client.page.evaluate((phone) => {
                    if (window.WPP?.conn?.genLinkDeviceCodeForPhoneNumber) {
                        return window.WPP.conn.genLinkDeviceCodeForPhoneNumber(phone);
                    }
                    if (window.Store?.Conn?.genLinkDeviceCodeForPhoneNumber) {
                        return window.Store.Conn.genLinkDeviceCodeForPhoneNumber(phone);
                    }
                    throw new Error('genLinkDeviceCodeForPhoneNumber not available');
                }, phoneNumber);
            } else {
                throw new Error('No pairing code method available');
            }
        } catch (error) {
            console.error('Error generating pairing code:', error);
            throw new Error(`Failed to generate pairing code: ${error.message}`);
        }

        if (!pairingCode) {
            throw new Error('Failed to generate pairing code - returned empty');
        }

        // Clean and validate pairing code
        pairingCode = pairingCode.toString().trim();
        if (pairingCode.length < 4) {
            throw new Error('Invalid pairing code format');
        }

        session.pairingCode = pairingCode;
        session.phoneNumber = phoneNumber;
        session.pairingCodeExpiry = new Date(Date.now() + 300000); // 5 minutes expiry
        session.lastPairingCodeGenerated = new Date();
        this.sessions.set(sessionId, session);

        console.log('New pairing code generated for session:', sessionId, 'Phone:', phoneNumber, 'Code:', pairingCode);

        return {
            success: true,
            pairingCode: pairingCode,
            phoneNumber: phoneNumber,
            message: 'New pairing code generated',
            expiry: session.pairingCodeExpiry
        };
    }

    // Wait for client to be ready
    async waitForClientReady(client, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkReady = () => {
                if (client.isReady) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error('Client ready timeout'));
                } else {
                    setTimeout(checkReady, 1000);
                }
            };
            
            checkReady();
        });
    }

    // Initialize session for pairing code method
    async initializePairingCodeSession(sessionId, client, phoneNumber) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error('Session not found');
        }

        if (!phoneNumber) {
            throw new Error('Phone number is required for pairing code method');
        }

        try {
            // Set up pairing code event listeners
            if (client.on) {
                client.on('pairing_code', this.handlePairingCode(sessionId));
                client.on('qr_code', () => {
                    console.log('QR code generated but session is set for pairing code');
                });
            }

            // Request initial pairing code
            const result = await this.generateNewPairingCode(sessionId, phoneNumber);
            return result;
        } catch (error) {
            console.error('Error initializing pairing code session:', error);
            throw error;
        }
    }

    // Check if pairing code has expired
    isPairingCodeExpired(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session || !session.pairingCodeExpiry) {
            return true; // Assume expired if no expiry set
        }
        return new Date() > session.pairingCodeExpiry;
    }

    // Get pairing code status
    getPairingCodeStatus(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        const now = new Date();
        const isExpired = this.isPairingCodeExpired(sessionId);
        
        return {
            pairingCode: session.pairingCode,
            pairingCodeExpiry: session.pairingCodeExpiry,
            isPairingExpired: isExpired,
            timeRemaining: isExpired ? 0 : Math.max(0, session.pairingCodeExpiry - now),
            lastGenerated: session.lastPairingCodeGenerated,
            status: session.status
        };
    }

    // Refresh pairing code if expired
    async refreshPairingCodeIfExpired(sessionId, phoneNumber) {
        if (this.isPairingCodeExpired(sessionId)) {
            try {
                return await this.generateNewPairingCode(sessionId, phoneNumber);
            } catch (error) {
                console.error('Error refreshing expired pairing code:', error);
                throw error;
            }
        }
        return this.getPairingCodeStatus(sessionId);
    }

    // Clean up expired pairing codes
    cleanupExpiredPairingCodes() {
        const now = new Date();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.pairingCodeExpiry && now > session.pairingCodeExpiry) {
                session.pairingCode = null;
                session.pairingCodeExpiry = null;
                if (session.status === 'pairing_code_ready') {
                    session.status = 'pairing_code_expired';
                }
                this.sessions.set(sessionId, session);
                console.log('Cleaned up expired pairing code for session:', sessionId);
            }
        }
    }

    // Validate pairing code format
    validatePairingCode(pairingCode) {
        if (!pairingCode || typeof pairingCode !== 'string') {
            return false;
        }
        
        // Basic validation - pairing codes are typically 8 digits
        const cleanCode = pairingCode.trim().replace(/\s+/g, '');
        return /^\d{8}$/.test(cleanCode);
    }
}

module.exports = PairingCodeHandler;